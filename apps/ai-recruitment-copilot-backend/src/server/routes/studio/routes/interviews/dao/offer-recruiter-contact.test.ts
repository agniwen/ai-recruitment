import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CandidateStageNotification from "../utils/candidate-stage-notification";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  interviewAuditLog,
  member,
  organization,
  studioInterview,
  studioOfferDraft,
  user,
} from "@arc/db-schema/schema";
import {
  createOfferDraft,
  editOfferDraft,
  receiveOfferSscConfirmation,
  removeOfferApprovalAttachment,
  sendOfferDraft,
} from "./offer-drafts";
import {
  CANDIDATE,
  FIRST_SSC,
  FORBIDDEN_USER,
  INPUT,
  ORG,
  SECOND_SSC,
  makeApp,
  setupOfferSscFixture,
} from "../__tests__/offer-ssc-fixture";

const notifications = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("./offer-ssc-notification-outbox", () => ({
  enqueueOfferSscNotification: notifications.enqueue,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({ deleteObject: vi.fn() }));
vi.mock("../utils/candidate-stage-notification", async (importOriginal) => ({
  ...(await importOriginal<typeof CandidateStageNotification>()),
  notifyCandidateStageChange: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: vi.fn(),
  safeUpdateTag: vi.fn(),
}));

setupOfferSscFixture();
const locator = { interviewRecordId: CANDIDATE, organizationId: ORG };
async function create() {
  return await createOfferDraft({ ...locator, actorId: SECOND_SSC, input: INPUT });
}
async function contactModule() {
  return await import("./offer-recruiter-contact");
}
async function submit(
  draft: { id: string; sscRevision?: number },
  overrides: Record<string, unknown> = {},
) {
  const { submitOfferRecruiterContact } = await contactModule();
  return await submitOfferRecruiterContact({
    ...locator,
    actorUserId: FIRST_SSC,
    candidatePrivateTelegram: "@candidate_a",
    draftId: draft.id,
    revision: draft.sscRevision ?? 1,
    source: "system",
    ...overrides,
  });
}
async function stored(id: string) {
  const rows = await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.id, id));
  return rows[0];
}
beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test/");
  vi.stubEnv("BETTER_AUTH_URL", "https://auth.example.test/");
  notifications.enqueue.mockReset().mockImplementation(() => Promise.resolve());
  await db.delete(interviewAuditLog).where(eq(interviewAuditLog.organizationId, ORG));
  await db.delete(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG));
  await db
    .update(studioInterview)
    .set({ createdBy: FIRST_SSC, outcome: "in_pipeline", pipelineStage: "offer" })
    .where(eq(studioInterview.id, CANDIDATE));
  await db
    .update(organization)
    .set({ slug: "recruiter-candidate-links" })
    .where(eq(organization.id, ORG));
  await db
    .update(user)
    .set({
      banned: false,
      telegram: "@recruiter_a",
      telegramBoundUsername: "recruiter_a",
      telegramChatId: "123456789",
    })
    .where(eq(user.id, FIRST_SSC));
});
afterEach(() => vi.unstubAllEnvs());

describe("recruiter contact gate for new Offer versions", () => {
  it.each([
    {
      appBase: "https://ats.example.test/",
      authBase: "https://auth.example.test/",
      expected:
        "https://ats.example.test/w/recruiter-candidate-links/studio/resumes/test_offer_ssc_candidate",
    },
    {
      appBase: "  ",
      authBase: " https://auth.example.test/ ",
      expected:
        "https://auth.example.test/w/recruiter-candidate-links/studio/resumes/test_offer_ssc_candidate",
    },
    { appBase: "", authBase: "", expected: null },
  ])(
    "keeps the candidate system link in pending and completed contexts: %j",
    async ({ appBase, authBase, expected }) => {
      vi.stubEnv("NEXT_PUBLIC_BASE_URL", appBase);
      vi.stubEnv("BETTER_AUTH_URL", authBase);
      const draft = await create();
      const { loadOfferRecruiterContactContext, loadTelegramOfferRecruiterContactContext } =
        await contactModule();
      const pending = await loadOfferRecruiterContactContext({
        ...locator,
        actorUserId: FIRST_SSC,
        draftId: draft.id,
      });
      expect(pending).toMatchObject({ candidateDetailUrl: expected, status: "pending" });
      expect(
        await loadTelegramOfferRecruiterContactContext({
          draftId: draft.id,
          telegramActor: { telegramUserId: "123456789", username: "recruiter_a" },
        }),
      ).toMatchObject({ candidateDetailUrl: expected, status: "pending" });
      expect(await submit(draft)).toMatchObject({
        candidateDetailUrl: expected,
        status: "completed",
      });
    },
  );

  it("creates a pending recruiter gate and queues only the uploader notice", async () => {
    const draft = await create();
    expect(await stored(draft.id)).toMatchObject({
      recruiterConfirmationStatus: "pending",
      recruiterConfirmedAt: null,
      recruiterConfirmedBy: null,
      recruiterConfirmedSource: null,
      sscConfirmationStatus: "pending",
    });
    expect(notifications.enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      ...locator,
      draftId: draft.id,
      event: "recruiter",
      revision: 1,
    });
  });
  it("does not let newly created versions bypass recruiter confirmation even with a supplied TG", async () => {
    const { offerConfirmationDetailsSchema } = await import("@arc/db-schema/offer-confirmation");
    const draft = await createOfferDraft({
      ...locator,
      input: {
        ...INPUT,
        confirmationInfo: offerConfirmationDetailsSchema.parse({
          candidatePrivateTelegram: "@candidate_a",
        }),
      },
    });
    expect(await stored(draft.id)).toMatchObject({ recruiterConfirmationStatus: "pending" });
    expect(notifications.enqueue.mock.calls.map((call) => call[1].event)).toEqual(["recruiter"]);
  });
  it("commits the contact snapshot, confirmation and one SSC notification together", async () => {
    const draft = await create();
    notifications.enqueue.mockClear();
    expect(await submit(draft)).toMatchObject({
      candidatePrivateTelegram: "@candidate_a",
      status: "completed",
    });
    expect(await stored(draft.id)).toMatchObject({
      confirmationInfo: { candidatePrivateTelegram: "@candidate_a" },
      recruiterConfirmationStatus: "completed",
      recruiterConfirmedBy: FIRST_SSC,
      recruiterConfirmedSource: "system",
      sscRevision: 1,
    });
    const saved = await stored(draft.id);
    expect(saved.recruiterConfirmedAt).toBeInstanceOf(Date);
    expect(notifications.enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      ...locator,
      draftId: draft.id,
      event: "pending",
      revision: 1,
    });
  });
  it("is idempotent for repeated equal confirmation but rejects a conflicting contact", async () => {
    const draft = await create();
    await submit(draft);
    notifications.enqueue.mockClear();
    await expect(submit(draft, { candidatePrivateTelegram: "candidate_a" })).resolves.toMatchObject(
      { status: "completed" },
    );
    await expect(
      submit(draft, { candidatePrivateTelegram: "@different_candidate" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });
  it("prefills a new version from the previous confirmed contact but requires confirmation again", async () => {
    const first = await create();
    await submit(first);
    notifications.enqueue.mockClear();
    const next = await create();
    expect(await stored(next.id)).toMatchObject({
      confirmationInfo: { candidatePrivateTelegram: "@candidate_a" },
      recruiterConfirmationStatus: "pending",
      recruiterConfirmedAt: null,
    });
    expect(notifications.enqueue.mock.calls.map((call) => call[1].event)).toEqual(["recruiter"]);
  });
  it("preserves a confirmed TG when ordinary updates omit it and rejects a different account", async () => {
    const draft = await create();
    await submit(draft);
    const { offerConfirmationDetailsSchema } = await import("@arc/db-schema/offer-confirmation");
    await editOfferDraft({
      draftId: draft.id,
      input: {
        confirmationInfo: offerConfirmationDetailsSchema.parse({
          candidateName: "Updated candidate",
        }),
      },
      organizationId: ORG,
    });
    const saved = await stored(draft.id);
    expect(saved.confirmationInfo?.candidatePrivateTelegram).toBe("@candidate_a");
    await expect(
      editOfferDraft({
        draftId: draft.id,
        input: {
          confirmationInfo: offerConfirmationDetailsSchema.parse({
            candidatePrivateTelegram: "@different_candidate",
          }),
        },
        organizationId: ORG,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back the contact when its durable SSC notification cannot be enqueued", async () => {
    const draft = await create();
    notifications.enqueue.mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(submit(draft)).rejects.toThrow("outbox unavailable");
    expect(await stored(draft.id)).toMatchObject({
      recruiterConfirmationStatus: "pending",
      recruiterConfirmedAt: null,
    });
  });
  it("keeps pending edits in the recruiter queue and does not reconfirm completed contacts for salary edits", async () => {
    const draft = await create();
    notifications.enqueue.mockClear();
    const edited = await editOfferDraft({
      draftId: draft.id,
      input: { baseSalary: 35_000 },
      organizationId: ORG,
    });
    expect(notifications.enqueue.mock.calls.map((call) => call[1].event)).toEqual(["recruiter"]);
    await submit(edited);
    notifications.enqueue.mockClear();
    await editOfferDraft({ draftId: draft.id, input: { baseSalary: 36_000 }, organizationId: ORG });
    expect(await stored(draft.id)).toMatchObject({
      confirmationInfo: { candidatePrivateTelegram: "@candidate_a" },
      recruiterConfirmationStatus: "completed",
      sscRevision: 3,
    });
    expect(notifications.enqueue.mock.calls.map((call) => call[1].event)).toEqual(["pending"]);
  });
  it("routes approval attachment removal through the recruiter queue while still pending", async () => {
    const draft = await create();
    await db
      .update(studioOfferDraft)
      .set({
        approvalAttachment: {
          filename: "approval.png",
          mediaType: "image/png",
          size: 1,
          storageKey: "private/approval",
        },
      })
      .where(eq(studioOfferDraft.id, draft.id));
    notifications.enqueue.mockClear();
    await removeOfferApprovalAttachment(draft.id, CANDIDATE, ORG);
    expect(notifications.enqueue.mock.calls.map((call) => call[1].event)).toEqual(["recruiter"]);
  });
  it("rejects SSC receiving and sending before recruiter completion", async () => {
    const draft = await create();
    await expect(
      receiveOfferSscConfirmation({
        ...locator,
        actor: { id: SECOND_SSC, role: "owner" },
        draftId: draft.id,
        revision: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await db
      .update(studioOfferDraft)
      .set({ sscConfirmationStatus: "completed" })
      .where(eq(studioOfferDraft.id, draft.id));
    await expect(sendOfferDraft(draft.id, ORG)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps historical null gates compatible with existing SSC receiving", async () => {
    const draft = await create();
    await db
      .update(studioOfferDraft)
      .set({ recruiterConfirmationStatus: null })
      .where(eq(studioOfferDraft.id, draft.id));
    await expect(
      receiveOfferSscConfirmation({
        ...locator,
        actor: { id: SECOND_SSC, role: "owner" },
        draftId: draft.id,
        revision: 1,
      }),
    ).resolves.toMatchObject({ sscConfirmationStatus: "confirming" });
  });
});

describe("recruiter contact authorization and stale input", () => {
  it("returns a minimal current task to an uploader without granting Offer read access", async () => {
    await db
      .update(studioInterview)
      .set({ createdBy: FORBIDDEN_USER })
      .where(eq(studioInterview.id, CANDIDATE));
    const draft = await create();
    const response = await makeApp(FORBIDDEN_USER).request(
      `/${CANDIDATE}/offer-drafts/recruiter-contact/current`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ...locator,
      canConfirm: true,
      draftId: draft.id,
      status: "pending",
    });
    for (const secret of [
      "baseSalary",
      "bonus",
      "equity",
      "confirmationInfo",
      "notes",
      "sscCompletionAttachment",
    ]) {
      expect(body).not.toHaveProperty(secret);
    }
  });
  it("does not expose the current task to unrelated members", async () => {
    await create();
    await expect(
      makeApp(FORBIDDEN_USER).request(`/${CANDIDATE}/offer-drafts/recruiter-contact/current`),
    ).resolves.toHaveProperty("status", 403);
  });
  it("returns no current task for an empty history, historical gate, or retired latest version", async () => {
    const { loadCurrentOfferRecruiterContactContext } = await contactModule();
    const input = { ...locator, actorUserId: FIRST_SSC };
    await expect(loadCurrentOfferRecruiterContactContext(input)).resolves.toBeNull();
    const first = await create();
    await db
      .update(studioOfferDraft)
      .set({ recruiterConfirmationStatus: null })
      .where(eq(studioOfferDraft.id, first.id));
    await expect(loadCurrentOfferRecruiterContactContext(input)).resolves.toBeNull();
    const latest = await create();
    await db
      .update(studioOfferDraft)
      .set({ status: "deleted" })
      .where(eq(studioOfferDraft.id, latest.id));
    await expect(loadCurrentOfferRecruiterContactContext(input)).resolves.toBeNull();
  });
  it("lets the current uploader use the dedicated endpoint without Offer update permission", async () => {
    await db
      .update(studioInterview)
      .set({ createdBy: FORBIDDEN_USER })
      .where(eq(studioInterview.id, CANDIDATE));
    const draft = await create();
    const response = await makeApp(FORBIDDEN_USER).request(
      `/${CANDIDATE}/offer-drafts/${draft.id}/recruiter-contact`,
      {
        body: JSON.stringify({ candidatePrivateTelegram: "@candidate_a", revision: 1 }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidatePrivateTelegram: "@candidate_a",
      status: "completed",
    });
  });
  it("rejects unrelated users and banned uploaders", async () => {
    const draft = await create();
    await expect(submit(draft, { actorUserId: FORBIDDEN_USER })).rejects.toMatchObject({
      status: 403,
    });
    await db.update(user).set({ banned: true }).where(eq(user.id, FIRST_SSC));
    await expect(submit(draft)).rejects.toMatchObject({ status: 403 });
  });
  it("allows a permitted administrator to complete an uploader contact task", async () => {
    const draft = await create();
    await expect(submit(draft, { actorUserId: SECOND_SSC })).resolves.toMatchObject({
      status: "completed",
    });
    expect(await stored(draft.id)).toMatchObject({ recruiterConfirmedBy: SECOND_SSC });
  });
  it("binds TG submissions to the uploader's verified numeric chat identity", async () => {
    const draft = await create();
    await expect(
      submit(draft, {
        actorUserId: undefined,
        source: "telegram",
        telegramActor: { telegramUserId: "123456789", username: "recruiter_a" },
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(await stored(draft.id)).toMatchObject({
      recruiterConfirmedBy: FIRST_SSC,
      recruiterConfirmedSource: "telegram",
    });
  });
  it.each([
    { telegramUserId: "99999", username: "recruiter_a" },
    { telegramUserId: "123456789", username: "impostor_a" },
  ])("rejects a TG identity that does not match the uploader: %o", async (telegramActor) => {
    const draft = await create();
    await expect(
      submit(draft, { actorUserId: undefined, source: "telegram", telegramActor }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not authorize a former workspace member through a stale TG binding", async () => {
    const draft = await create();
    const [membership] = await db.select().from(member).where(eq(member.userId, FIRST_SSC));
    await db.delete(member).where(eq(member.id, membership.id));
    try {
      await expect(
        submit(draft, {
          actorUserId: undefined,
          source: "telegram",
          telegramActor: { telegramUserId: "123456789", username: "recruiter_a" },
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.insert(member).values(membership);
    }
  });
  it("rejects an old revision, superseded version and cross-workspace locator", async () => {
    const draft = await create();
    await expect(submit(draft, { revision: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(submit(draft, { organizationId: "other-workspace" })).rejects.toMatchObject({
      status: 404,
    });
    await create();
    await expect(submit(draft)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["deleted", "expired"] as const)("rejects current %s versions", async (status) => {
    const draft = await create();
    await db.update(studioOfferDraft).set({ status }).where(eq(studioOfferDraft.id, draft.id));
    await expect(submit(draft)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a closed candidate and an expired draft", async () => {
    const draft = await create();
    await db
      .update(studioOfferDraft)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(studioOfferDraft.id, draft.id));
    await expect(submit(draft)).rejects.toMatchObject({ status: 409 });
    await db
      .update(studioOfferDraft)
      .set({ expiresAt: null })
      .where(eq(studioOfferDraft.id, draft.id));
    await db
      .update(studioInterview)
      .set({ outcome: "rejected", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    await expect(submit(draft)).rejects.toMatchObject({ status: 409 });
  });
  it("offers an authorized TG locator with enough metadata to redraw the recruiter card", async () => {
    const draft = await create();
    const { loadTelegramOfferRecruiterContactContext } = await contactModule();
    await expect(
      loadTelegramOfferRecruiterContactContext({
        draftId: draft.id,
        telegramActor: { telegramUserId: "123456789", username: "recruiter_a" },
      }),
    ).resolves.toMatchObject({
      ...locator,
      canConfirm: true,
      candidateName: "SSC 候选人",
      draftId: draft.id,
      position: "工程师",
      recruiterName: FIRST_SSC,
      revision: 1,
      status: "pending",
      version: 1,
    });
  });
});
