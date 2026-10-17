import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  interviewAuditLog,
  member,
  organization,
  organizationRole,
  recruitingGroup,
  recruitingGroupMember,
  studioInterview,
  studioOfferDraft,
  user,
} from "@arc/db-schema/schema";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  createOfferDraft,
  editOfferDraft,
  editOfferDraftWithAttachment,
  removeOfferApprovalAttachment,
  sendOfferDraft,
} from "../dao/offer-drafts";
import { offerDraftsRouter } from "../routes/offer-drafts/route";

// The real DAO, permission snapshot and database stay in this suite. Only external
// delivery/storage and the request middleware are replaced; the shared SSC action
// must enforce current membership and permissions even without HTTP middleware.
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => await next(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  buildOfferApprovalAttachmentKey: vi.fn(),
  deleteObject: vi.fn(),
  getObjectStream: vi.fn(),
  putObjectBytes: vi.fn(),
}));
vi.mock("../utils/candidate-stage-notification", () => ({
  notifyCandidateStageChange: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: vi.fn(),
  safeUpdateTag: vi.fn(),
}));

const ORG = "test_offer_ssc_org";
const CANDIDATE = "test_offer_ssc_candidate";
const FIRST_SSC = "test_offer_ssc_first";
const SECOND_SSC = "test_offer_ssc_second";
const FORBIDDEN_USER = "test_offer_ssc_forbidden";
const RECEIVE_ONLY_SSC = "test_offer_ssc_receive_only";
const CONFIRM_ONLY_SSC = "test_offer_ssc_confirm_only";
const FIXTURE_MEMBERS = [
  { id: FIRST_SSC, role: "owner" },
  { id: SECOND_SSC, role: "owner" },
  { id: FORBIDDEN_USER, role: "noAccess" },
  { id: RECEIVE_ONLY_SSC, role: "sscReceiveOnly" },
  { id: CONFIRM_ONLY_SSC, role: "sscConfirmOnly" },
];
const INPUT = { baseSalary: 30_000, currency: "CNY", position: "工程师" };

async function cleanup() {
  await db.delete(organization).where(eq(organization.id, ORG));
  for (const { id } of FIXTURE_MEMBERS) {
    await db.delete(user).where(eq(user.id, id));
  }
}

beforeAll(async () => {
  await cleanup();
  await db.insert(organization).values({ id: ORG, name: "Offer SSC test", slug: ORG });
  await db.insert(organizationRole).values([
    {
      id: `${ORG}_receive_role`,
      name: "SSC 接收确认测试角色",
      organizationId: ORG,
      permission: JSON.stringify({ offer: ["read", "receive"] }),
      role: "sscReceiveOnly",
    },
    {
      id: `${ORG}_confirm_role`,
      name: "SSC 完成确认测试角色",
      organizationId: ORG,
      permission: JSON.stringify({ offer: ["read", "confirm"] }),
      role: "sscConfirmOnly",
    },
  ]);
  for (const { id, role } of FIXTURE_MEMBERS) {
    await db.insert(user).values({ email: `${id}@example.com`, id, name: id });
    await db.insert(member).values({
      id: `${id}_membership`,
      organizationId: ORG,
      role,
      userId: id,
    });
  }
  const groupId = `${ORG}_recruiting_group`;
  await db.insert(recruitingGroup).values({
    id: groupId,
    name: "SSC 可见范围测试组",
    organizationId: ORG,
  });
  // Both custom roles can see the creator's candidate through the real group
  // hierarchy; neither relies on owner/admin visibility or an ODC source map.
  await db.insert(recruitingGroupMember).values([
    { groupId, id: `${groupId}_creator`, organizationId: ORG, role: "hr", userId: FIRST_SSC },
    {
      groupId,
      id: `${groupId}_receiver`,
      organizationId: ORG,
      role: "recruitingLead",
      userId: RECEIVE_ONLY_SSC,
    },
    {
      groupId,
      id: `${groupId}_confirmer`,
      organizationId: ORG,
      role: "recruitingLead",
      userId: CONFIRM_ONLY_SSC,
    },
  ]);
  await db.insert(studioInterview).values({
    candidateName: "SSC 候选人",
    createdBy: FIRST_SSC,
    id: CANDIDATE,
    organizationId: ORG,
    pipelineStage: "offer",
  });
});
afterAll(cleanup);
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  await db.delete(interviewAuditLog).where(eq(interviewAuditLog.organizationId, ORG));
  await db.delete(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG));
  await db
    .update(studioInterview)
    .set({ outcome: "in_pipeline", pipelineStage: "offer" })
    .where(eq(studioInterview.id, CANDIDATE));
});

function makeApp(actorId = FIRST_SSC) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: ORG } as never);
      c.set("user", { id: actorId } as never);
      // Deliberately spoof the request role for restricted fixture users. The shared
      // service must read the actual membership rather than trust this value.
      c.set("member", { role: "owner" } as never);
      await next();
    })
    .route("/:id/offer-drafts", offerDraftsRouter);
}

function requestAction(
  draftId: string,
  action: "receive" | "complete",
  revision = 1,
  actorId = FIRST_SSC,
  recordId = CANDIDATE,
) {
  return makeApp(actorId).request(`/${recordId}/offer-drafts/${draftId}/ssc/${action}`, {
    body: JSON.stringify({ revision }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

async function newOffer() {
  return await createOfferDraft({
    input: INPUT,
    interviewRecordId: CANDIDATE,
    organizationId: ORG,
  });
}

describe("Offer SSC confirmation", () => {
  it("creates a pending internal Offer", async () => {
    const offer = await newOffer();
    expect(offer).toMatchObject({
      sscConfirmationStatus: "pending",
      sscRevision: 1,
      status: "draft",
    });
  });

  it("cannot create an Offer already sent", async () => {
    await expect(
      createOfferDraft({
        input: INPUT,
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        sendImmediately: true,
      }),
    ).rejects.toThrow();
    expect(
      await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG)),
    ).toHaveLength(0);
  });

  it("does not create an Offer for a candidate that closed before the DAO lock", async () => {
    await db
      .update(studioInterview)
      .set({ outcome: "withdrawn", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    await expect(newOffer()).rejects.toThrow();
    expect(
      await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG)),
    ).toHaveLength(0);
  });

  it.each(["pending", "confirming"] as const)(
    "cannot send an Offer while SSC is %s",
    async (sscConfirmationStatus) => {
      const offer = await newOffer();
      await db
        .update(studioOfferDraft)
        .set({ sscConfirmationStatus })
        .where(eq(studioOfferDraft.id, offer.id));
      await expect(sendOfferDraft(offer.id, ORG)).rejects.toThrow();
      const [stored] = await db
        .select()
        .from(studioOfferDraft)
        .where(eq(studioOfferDraft.id, offer.id));
      expect(stored?.status).toBe("draft");
      expect(stored?.sentAt).toBeNull();
    },
  );

  it("allows a different SSC to finish after the first SSC receives, then permits sending", async () => {
    const offer = await newOffer();
    const received = await requestAction(offer.id, "receive");
    expect(received.status).toBe(200);
    expect(await received.json()).toMatchObject({
      sscConfirmationStatus: "confirming",
      sscReceivedBy: FIRST_SSC,
    });
    const completed = await requestAction(offer.id, "complete", 1, SECOND_SSC);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      sscCompletedBy: SECOND_SSC,
      sscConfirmationStatus: "completed",
    });
    expect(await sendOfferDraft(offer.id, ORG)).toMatchObject({ status: "sent" });
  });

  it("does not allow completion before receipt", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "complete")).resolves.toHaveProperty("status", 409);
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored?.sscConfirmationStatus).toBe("pending");
  });

  it("keeps the first receiver and completion facts on repeated actions", async () => {
    const offer = await newOffer();
    const first = await requestAction(offer.id, "receive");
    expect(first.status).toBe(200);
    const received = await first.json();
    const repeated = await requestAction(offer.id, "receive", 1, SECOND_SSC);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      sscReceivedAt: received.sscReceivedAt,
      sscReceivedBy: FIRST_SSC,
    });
    const completed = await requestAction(offer.id, "complete", 1, SECOND_SSC);
    expect(completed.status).toBe(200);
    const completion = await completed.json();
    const repeatedCompletion = await requestAction(offer.id, "complete", 1, FIRST_SSC);
    expect(repeatedCompletion.status).toBe(200);
    expect(await repeatedCompletion.json()).toMatchObject({
      sscCompletedAt: completion.sscCompletedAt,
      sscCompletedBy: SECOND_SSC,
    });
    const activity = await db
      .select({ action: interviewAuditLog.action })
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.organizationId, ORG))
      .orderBy(interviewAuditLog.createdAt);
    expect(activity.map((entry) => entry.action)).toEqual([
      "offer_ssc_received",
      "offer_ssc_completed",
    ]);
  });

  it("serializes concurrent receipts so exactly one receiver is recorded", async () => {
    const offer = await newOffer();
    const results = await Promise.all([
      requestAction(offer.id, "receive", 1, FIRST_SSC),
      requestAction(offer.id, "receive", 1, SECOND_SSC),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const records = await Promise.all(results.map((result) => result.json()));
    expect(records[0].sscReceivedBy).toBe(records[1].sscReceivedBy);
    expect([FIRST_SSC, SECOND_SSC]).toContain(records[0].sscReceivedBy);
  });

  it("resets completed confirmation on changed terms and rejects stale buttons", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 200);
    await expect(requestAction(offer.id, "complete")).resolves.toHaveProperty("status", 200);
    const updated = await editOfferDraft({
      draftId: offer.id,
      input: { baseSalary: 35_000 },
      organizationId: ORG,
    });
    expect(updated).toMatchObject({
      sscCompletedAt: null,
      sscCompletedBy: null,
      sscConfirmationStatus: "pending",
      sscReceivedAt: null,
      sscReceivedBy: null,
      sscRevision: 2,
    });
    await expect(requestAction(offer.id, "receive", 1)).resolves.toHaveProperty("status", 409);
    await expect(requestAction(offer.id, "complete", 1)).resolves.toHaveProperty("status", 409);
    await expect(requestAction(offer.id, "receive", 2)).resolves.toHaveProperty("status", 200);
  });

  it("does not reset confirmation for an unchanged save", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 200);
    const unchanged = await editOfferDraft({
      draftId: offer.id,
      input: INPUT,
      organizationId: ORG,
    });
    expect(unchanged).toMatchObject({
      sscConfirmationStatus: "confirming",
      sscReceivedBy: FIRST_SSC,
      sscRevision: 1,
    });
  });

  it("invalidates confirmation when the review attachment is removed", async () => {
    const offer = await newOffer();
    await editOfferDraftWithAttachment({
      approvalAttachment: {
        filename: "review.png",
        mediaType: "image/png",
        size: 3,
        storageKey: "ssc/review.png",
      },
      draftId: offer.id,
      input: {},
      organizationId: ORG,
    });
    await expect(requestAction(offer.id, "receive", 2)).resolves.toHaveProperty("status", 200);
    await expect(requestAction(offer.id, "complete", 2)).resolves.toHaveProperty("status", 200);
    await removeOfferApprovalAttachment(offer.id, CANDIDATE, ORG);
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored).toMatchObject({
      approvalAttachment: null,
      sscConfirmationStatus: "pending",
      sscRevision: 3,
    });
  });

  it("checks the actual member permission even when HTTP middleware was bypassed", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive", 1, FORBIDDEN_USER)).resolves.toHaveProperty(
      "status",
      403,
    );
  });

  it("allows the custom receive-only role to receive but never complete confirmation", async () => {
    const offer = await newOffer();
    const received = await requestAction(offer.id, "receive", 1, RECEIVE_ONLY_SSC);
    expect(received.status).toBe(200);
    expect(await received.json()).toMatchObject({
      sscConfirmationStatus: "confirming",
      sscReceivedBy: RECEIVE_ONLY_SSC,
    });
    await expect(requestAction(offer.id, "complete", 1, RECEIVE_ONLY_SSC)).resolves.toHaveProperty(
      "status",
      403,
    );
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored).toMatchObject({ sscCompletedBy: null, sscConfirmationStatus: "confirming" });
  });

  it("allows the custom confirm-only role to finish another SSC's receipt but never receive", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive", 1, CONFIRM_ONLY_SSC)).resolves.toHaveProperty(
      "status",
      403,
    );
    await expect(requestAction(offer.id, "receive", 1, RECEIVE_ONLY_SSC)).resolves.toHaveProperty(
      "status",
      200,
    );
    const completed = await requestAction(offer.id, "complete", 1, CONFIRM_ONLY_SSC);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      sscCompletedBy: CONFIRM_ONLY_SSC,
      sscConfirmationStatus: "completed",
      sscReceivedBy: RECEIVE_ONLY_SSC,
    });
    const activity = await db
      .select({ operatorRole: interviewAuditLog.operatorRole })
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.organizationId, ORG))
      .orderBy(interviewAuditLog.createdAt);
    expect(activity.map((entry) => entry.operatorRole)).toEqual([
      "sscReceiveOnly",
      "sscConfirmOnly",
    ]);
  });

  it("does not accept an Offer through another candidate's URL", async () => {
    const offer = await newOffer();
    await expect(
      requestAction(offer.id, "receive", 1, FIRST_SSC, "wrong-candidate"),
    ).resolves.toHaveProperty("status", 404);
  });

  it.each(["deleted", "superseded"] as const)(
    "rejects SSC actions on %s versions",
    async (status) => {
      const offer = await newOffer();
      await db.update(studioOfferDraft).set({ status }).where(eq(studioOfferDraft.id, offer.id));
      await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 409);
    },
  );

  it("rejects SSC actions after the candidate closes", async () => {
    const offer = await newOffer();
    await db
      .update(studioInterview)
      .set({ outcome: "withdrawn", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 409);
  });

  it("preserves the send behavior of historical null SSC records", async () => {
    const offer = await newOffer();
    await db
      .update(studioOfferDraft)
      .set({ sscConfirmationStatus: null })
      .where(eq(studioOfferDraft.id, offer.id));
    expect(await sendOfferDraft(offer.id, ORG)).toMatchObject({ status: "sent" });
  });

  it("provides a bot entry link only for an authorized Offer reader", async () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "@ssc_test_bot");
    const offer = await newOffer();
    const path = `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/telegram-link`;
    const response = await makeApp().request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: `https://t.me/ssc_test_bot?start=offer_${offer.id}`,
    });
    await expect(makeApp(FORBIDDEN_USER).request(path)).resolves.toHaveProperty("status", 403);
  });

  it.each(["", "undefined", "null", "@undefined", "NULL"])(
    "returns no bot entry link when the bot username is not configured: %s",
    async (username) => {
      vi.stubEnv("TELEGRAM_BOT_USERNAME", username);
      const offer = await newOffer();
      const response = await makeApp().request(
        `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/telegram-link`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: null });
    },
  );
});
