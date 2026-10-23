import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog, studioInterview, studioOfferDraft, user } from "@arc/db-schema/schema";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import {
  completeOfferSscConfirmation,
  createOfferDraft,
  editOfferDraft,
  listOfferDrafts,
  loadAuthorizedOfferSscContext,
  loadDraftById,
  receiveOfferSscConfirmation,
} from "./offer-drafts";
import {
  CANDIDATE,
  FIRST_SSC,
  FORBIDDEN_USER,
  INPUT,
  ORG,
  RECEIVE_ONLY_SSC,
  makeApp,
  setupOfferSscFixture,
} from "../__tests__/offer-ssc-fixture";

vi.mock("./offer-ssc-notification-outbox", () => ({
  enqueueOfferSscNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({ deleteObject: vi.fn() }));
vi.mock("../utils/candidate-stage-notification", () => ({ notifyCandidateStageChange: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: vi.fn(),
  safeUpdateTag: vi.fn(),
}));

setupOfferSscFixture();
const date = "2026-11-01";
const locator = { interviewRecordId: CANDIDATE, organizationId: ORG };
const actor = { id: FIRST_SSC, role: "owner" };
beforeEach(async () => {
  await db.delete(interviewAuditLog).where(eq(interviewAuditLog.organizationId, ORG));
  await db.delete(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG));
  await db
    .update(studioInterview)
    .set({
      candidateName: "SSC 候选人",
      createdBy: FIRST_SSC,
      outcome: "in_pipeline",
      pipelineStage: "offer",
    })
    .where(eq(studioInterview.id, CANDIDATE));
  await db.update(user).set({ telegram: null }).where(eq(user.id, FIRST_SSC));
});
afterEach(() => {
  vi.restoreAllMocks();
});
async function create() {
  const draft = await createOfferDraft({ ...locator, input: INPUT });
  await db
    .update(studioOfferDraft)
    .set({ recruiterConfirmationStatus: null })
    .where(eq(studioOfferDraft.id, draft.id));
  return draft;
}
function input(draftId: string, revision = 1) {
  return { ...locator, actor, draftId, revision };
}
function confirmDate(draftId: string, preboardingDate: string, userId = FIRST_SSC, revision = 1) {
  return makeApp(userId).request(`/${CANDIDATE}/offer-drafts/${draftId}/ssc/preboarding-date`, {
    body: JSON.stringify({ preboardingDate, revision }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
async function stored(draftId: string) {
  const [draft] = await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.id, draftId));
  return draft;
}

async function legacyDateWithoutPreview(
  overrides: Partial<typeof studioOfferDraft.$inferInsert> = {},
) {
  const draft = await create();
  await receiveOfferSscConfirmation(input(draft.id));
  await db.update(user).set({ telegram: "@legacy_recruiter" }).where(eq(user.id, FIRST_SSC));
  await db
    .update(studioInterview)
    .set({ recruitmentSource: "tg", recruitmentSourceDetail: "Legacy resume source" })
    .where(eq(studioInterview.id, CANDIDATE));
  await db
    .update(studioOfferDraft)
    .set({
      completionInfo: null,
      confirmationInfo: offerConfirmationDetailsSchema.parse({
        candidateCode: "LEGACY-001",
        candidateName: "SSC 候选人",
        candidatePrivateTelegram: "@legacy_candidate",
      }),
      preboardingDate: date,
      ...overrides,
    })
    .where(eq(studioOfferDraft.id, draft.id));
  return draft;
}

const previewReaders = [
  [
    "authorized system context",
    async (draftId: string) => {
      const context = await loadAuthorizedOfferSscContext({
        ...locator,
        actorUserId: FIRST_SSC,
        draftId,
      });
      return context.draft;
    },
  ],
  ["organization draft detail", async (draftId: string) => await loadDraftById(draftId, ORG)],
  [
    "candidate draft list",
    async (draftId: string) => {
      const drafts = await listOfferDrafts(CANDIDATE, ORG);
      return drafts.find((draft) => draft.id === draftId);
    },
  ],
] as const;

describe("read-only previews for already-confirmed legacy dates", () => {
  it.each(previewReaders)(
    "derives sections for %s without updating an Offer or audit",
    async (_name, read) => {
      const draft = await legacyDateWithoutPreview();
      const before = await stored(draft.id);
      const previousAudit = await db
        .select()
        .from(interviewAuditLog)
        .where(eq(interviewAuditLog.interviewRecordId, CANDIDATE));
      const update = vi.spyOn(db, "update");
      const insert = vi.spyOn(db, "insert");
      const transaction = vi.spyOn(db, "transaction");
      const result = await read(draft.id);
      expect(result).toMatchObject({
        completionInfo: {
          candidateCode: "LEGACY-001",
          candidateName: "SSC 候选人",
          candidatePrivateTelegram: "@legacy_candidate",
          preboardingDate: date,
          recruiterTelegram: "@legacy_recruiter",
          recruitingGroupNames: ["SSC 可见范围测试组"],
          recruitmentChannel: "TG",
          resumeSource: "Legacy resume source",
        },
        preboardingDate: date,
        sscCompletedAt: null,
        sscConfirmationStatus: "confirming",
      });
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(await stored(draft.id)).toEqual(before);
      expect(
        await db
          .select()
          .from(interviewAuditLog)
          .where(eq(interviewAuditLog.interviewRecordId, CANDIDATE)),
      ).toEqual(previousAudit);
    },
  );

  it.each(["confirming", "completed"] as const)(
    "preserves an existing %s snapshot across readers",
    async (sscConfirmationStatus) => {
      const completionInfo = {
        candidateCode: "FROZEN-CODE",
        candidateName: "冻结的 Offer 姓名",
        candidatePrivateTelegram: "@frozen_candidate",
        preboardingDate: date,
        recruiterTelegram: "@frozen_recruiter",
        recruitingGroupNames: ["冻结的招聘组"],
        recruitmentChannel: "冻结通道",
        resumeSource: "冻结来源",
      };
      const draft = await legacyDateWithoutPreview({ completionInfo, sscConfirmationStatus });
      for (const [, read] of previewReaders) {
        const result = await read(draft.id);
        expect(result?.completionInfo).toEqual(completionInfo);
      }
      const persisted = await stored(draft.id);
      expect(persisted.completionInfo).toEqual(completionInfo);
    },
  );

  it.each([
    ["pending receipt", { sscConfirmationStatus: "pending" }],
    ["missing date", { preboardingDate: null }],
    ["historical completed without a snapshot", { sscConfirmationStatus: "completed" }],
    ["sent Offer", { status: "sent" }],
    ["superseded Offer", { status: "superseded" }],
    ["expired Offer", { expiresAt: new Date("2000-01-01T00:00:00Z") }],
    ["unfinished recruiter handoff", { recruiterConfirmationStatus: "pending" }],
  ] as const)("does not derive a preview for %s", async (_name, overrides) => {
    const draft = await legacyDateWithoutPreview(overrides);
    for (const [, read] of previewReaders) {
      const result = await read(draft.id);
      expect(result?.completionInfo).toBeNull();
    }
    const persisted = await stored(draft.id);
    expect(persisted.completionInfo).toBeNull();
  });

  it("does not derive details after the candidate is closed", async () => {
    const draft = await legacyDateWithoutPreview();
    await db
      .update(studioInterview)
      .set({ outcome: "rejected", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    for (const [, read] of previewReaders) {
      const result = await read(draft.id);
      expect(result?.completionInfo).toBeNull();
    }
  });

  it("does not revive an older draft when a newer deleted version exists", async () => {
    const draft = await legacyDateWithoutPreview();
    const latest = await create();
    await db
      .update(studioOfferDraft)
      .set({ status: "deleted" })
      .where(eq(studioOfferDraft.id, latest.id));
    await db
      .update(studioOfferDraft)
      .set({ status: "draft" })
      .where(eq(studioOfferDraft.id, draft.id));
    for (const [, read] of previewReaders) {
      const result = await read(draft.id);
      expect(result?.completionInfo).toBeNull();
    }
  });

  it("does not return derived data through another organization", async () => {
    const draft = await legacyDateWithoutPreview();
    expect(await loadDraftById(draft.id, `${ORG}_other`)).toBeNull();
    expect(await listOfferDrafts(CANDIDATE, `${ORG}_other`)).toEqual([]);
    await expect(
      loadAuthorizedOfferSscContext({
        actorUserId: FIRST_SSC,
        draftId: draft.id,
        organizationId: `${ORG}_other`,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not use a legacy preview to grant a system member access", async () => {
    const draft = await legacyDateWithoutPreview();
    await expect(
      loadAuthorizedOfferSscContext({
        ...locator,
        actorUserId: FORBIDDEN_USER,
        draftId: draft.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const persisted = await stored(draft.id);
    expect(persisted.completionInfo).toBeNull();
  });
});

describe("SSC confirmed preboarding date", () => {
  it("requires a confirmed preboarding date before final completion", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    await expect(
      completeOfferSscConfirmation({ ...input(draft.id), internalApprovalConfirmed: true }),
    ).rejects.toMatchObject({ message: expect.stringContaining("预入职"), status: 409 });
    expect(await stored(draft.id)).toMatchObject({ sscConfirmationStatus: "confirming" });
  });

  it("saves the exact date on the current Offer without changing the ODC joining date", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const response = await confirmDate(draft.id, date);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ joiningDate: null, preboardingDate: date });
    expect(await stored(draft.id)).toMatchObject({ joiningDate: null, preboardingDate: date });
  });

  it.each([
    "2026-2-03",
    "2026/11/01",
    "2026-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-11-01T00:00:00Z",
    "",
  ])("rejects a malformed or impossible date %j", async (value) => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const response = await confirmDate(draft.id, value);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("YYYY-MM-DD") });
  });

  it("accepts a valid leap day and does not change timezone calendar days", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const response = await confirmDate(draft.id, "2028-02-29");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preboardingDate: "2028-02-29" });
  });

  it("requires SSC receipt and leaves an unreceived Offer unchanged", async () => {
    const draft = await create();
    const response = await confirmDate(draft.id, date);
    expect(response.status).toBe(409);
    expect(await stored(draft.id)).toMatchObject({ sscConfirmationStatus: "pending" });
  });

  it.each([FORBIDDEN_USER, RECEIVE_ONLY_SSC])(
    "requires confirmation permission for %s",
    async (userId) => {
      const draft = await create();
      await receiveOfferSscConfirmation(input(draft.id));
      const response = await confirmDate(draft.id, date, userId);
      expect(response.status).toBe(403);
    },
  );

  it("saves once for duplicate input and audits an explicit correction", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const first = await confirmDate(draft.id, date);
    expect(first.status).toBe(200);
    const duplicate = await confirmDate(draft.id, date);
    expect(duplicate.status).toBe(200);
    const corrected = await confirmDate(draft.id, "2026-11-02");
    expect(corrected.status).toBe(200);
    const rows = await db
      .select()
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.interviewRecordId, CANDIDATE));
    const dates = rows.filter((row) => row.action === "offer_ssc_preboarding_date_confirmed");
    expect(dates).toHaveLength(2);
    expect(dates.map((row) => row.detail.preboardingDate)).toEqual(
      expect.arrayContaining([date, "2026-11-02"]),
    );
    expect(await stored(draft.id)).toMatchObject({
      completionInfo: { preboardingDate: "2026-11-02" },
      preboardingDate: "2026-11-02",
      sscConfirmationStatus: "confirming",
    });
  });

  it("generates recruitment and onboarding previews with the date and resnapshots on final completion", async () => {
    const draft = await create();
    await db.update(user).set({ telegram: "@preview_recruiter" }).where(eq(user.id, FIRST_SSC));
    await receiveOfferSscConfirmation(input(draft.id));
    const dateResponse = await confirmDate(draft.id, date);
    expect(dateResponse.status).toBe(200);
    const preview = {
      completionInfo: {
        candidateName: "SSC 候选人",
        preboardingDate: date,
        recruiterTelegram: "@preview_recruiter",
      },
      preboardingDate: date,
      sscCompletedAt: null,
      sscConfirmationStatus: "confirming",
    };
    expect(await dateResponse.json()).toMatchObject(preview);
    expect(await stored(draft.id)).toMatchObject(preview);
    await db.update(user).set({ telegram: "@final_recruiter" }).where(eq(user.id, FIRST_SSC));
    const completed = await completeOfferSscConfirmation({
      ...input(draft.id),
      internalApprovalConfirmed: true,
    });
    expect(completed).toMatchObject({
      completionInfo: {
        candidateName: "SSC 候选人",
        preboardingDate: date,
        recruiterTelegram: "@final_recruiter",
      },
      preboardingDate: date,
      sscConfirmationStatus: "completed",
    });
    const corrected = await confirmDate(draft.id, "2026-11-02");
    expect(corrected.status).toBe(409);
  });

  it("can regenerate a missing preview for the same date on an uncompleted Offer", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    await db
      .update(studioOfferDraft)
      .set({ completionInfo: null, preboardingDate: date })
      .where(eq(studioOfferDraft.id, draft.id));
    const response = await confirmDate(draft.id, date);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      completionInfo: { candidateName: "SSC 候选人", preboardingDate: date },
      preboardingDate: date,
      sscCompletedAt: null,
      sscConfirmationStatus: "confirming",
    });
  });

  it("does not reuse a received date after terms change or a new version is created", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const dateResponse = await confirmDate(draft.id, date);
    expect(dateResponse.status).toBe(200);
    const edited = await editOfferDraft({
      draftId: draft.id,
      input: { baseSalary: 31_000 },
      organizationId: ORG,
    });
    expect(edited).toMatchObject({ completionInfo: null, preboardingDate: null, sscRevision: 2 });
    const oldRevision = await confirmDate(draft.id, date);
    expect(oldRevision.status).toBe(409);
    const next = await create();
    expect(next).toMatchObject({ completionInfo: null, preboardingDate: null });
    const superseded = await confirmDate(draft.id, date, FIRST_SSC, 2);
    expect(superseded.status).toBe(409);
  });

  it("keeps the saved completion snapshot when recruiter and candidate profiles change", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const dateResponse = await confirmDate(draft.id, date);
    expect(dateResponse.status).toBe(200);
    const completed = await completeOfferSscConfirmation({
      ...input(draft.id),
      internalApprovalConfirmed: true,
    });
    await db.update(user).set({ telegram: "@changed_recruiter" }).where(eq(user.id, FIRST_SSC));
    await db
      .update(studioInterview)
      .set({ candidateName: "后来修改的名字" })
      .where(eq(studioInterview.id, CANDIDATE));
    const repeated = await completeOfferSscConfirmation({
      ...input(draft.id),
      internalApprovalConfirmed: true,
    });
    expect(repeated.completionInfo).toEqual(completed.completionInfo);
    expect(repeated.completionInfo?.candidateName).toBe("SSC 候选人");
  });

  it("rejects final confirmation from a card showing an older preboarding date", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    const firstDate = await confirmDate(draft.id, date);
    expect(firstDate.status).toBe(200);
    const corrected = await confirmDate(draft.id, "2026-11-02");
    expect(corrected.status).toBe(200);
    await expect(
      completeOfferSscConfirmation({
        ...input(draft.id),
        expectedPreboardingDate: date,
        internalApprovalConfirmed: true,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("预入职日期已更新"), status: 409 });
    expect(await stored(draft.id)).toMatchObject({
      completionInfo: { preboardingDate: "2026-11-02" },
      preboardingDate: "2026-11-02",
      sscConfirmationStatus: "confirming",
    });
    await expect(
      completeOfferSscConfirmation({
        ...input(draft.id),
        expectedPreboardingDate: "2026-11-02",
        internalApprovalConfirmed: true,
      }),
    ).resolves.toMatchObject({
      completionInfo: { preboardingDate: "2026-11-02" },
      sscConfirmationStatus: "completed",
    });
  });

  it.each(["json", "multipart"] as const)(
    "rejects stale expected dates on the %s completion route",
    async (format) => {
      const draft = await create();
      await receiveOfferSscConfirmation(input(draft.id));
      const saved = await confirmDate(draft.id, "2026-11-02");
      expect(saved.status).toBe(200);
      const form = new FormData();
      form.set("revision", "1");
      form.set("expectedPreboardingDate", date);
      form.set("internalApprovalConfirmed", "true");
      const response = await makeApp().request(
        `/${CANDIDATE}/offer-drafts/${draft.id}/ssc/${format === "json" ? "complete" : "complete-with-attachment"}`,
        {
          body:
            format === "json"
              ? JSON.stringify({
                  expectedPreboardingDate: date,
                  internalApprovalConfirmed: true,
                  revision: 1,
                })
              : form,
          headers: format === "json" ? { "Content-Type": "application/json" } : undefined,
          method: "POST",
        },
      );
      expect(response.status).toBe(409);
      expect(await stored(draft.id)).toMatchObject({
        preboardingDate: "2026-11-02",
        sscConfirmationStatus: "confirming",
      });
    },
  );

  it("rejects a closed candidate and an expired current Offer", async () => {
    const draft = await create();
    await receiveOfferSscConfirmation(input(draft.id));
    await db
      .update(studioInterview)
      .set({ outcome: "rejected", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    const closed = await confirmDate(draft.id, date);
    expect(closed.status).toBe(409);
    await db
      .update(studioInterview)
      .set({ outcome: "in_pipeline", pipelineStage: "offer" })
      .where(eq(studioInterview.id, CANDIDATE));
    await db
      .update(studioOfferDraft)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(studioOfferDraft.id, draft.id));
    const expired = await confirmDate(draft.id, date);
    expect(expired.status).toBe(409);
  });

  it("keeps historical completed Offers idempotent without backfilling a date", async () => {
    const draft = await create();
    await db
      .update(studioOfferDraft)
      .set({ sscConfirmationStatus: "completed" })
      .where(eq(studioOfferDraft.id, draft.id));
    await expect(
      completeOfferSscConfirmation({ ...input(draft.id), internalApprovalConfirmed: true }),
    ).resolves.toMatchObject({ sscConfirmationStatus: "completed" });
  });
});
