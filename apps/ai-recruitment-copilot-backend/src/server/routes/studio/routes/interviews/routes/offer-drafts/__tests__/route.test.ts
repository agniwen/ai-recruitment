import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { OfferDraftError } from "../../../dao/offer-drafts";

const mocks = vi.hoisted(() => ({
  buildOfferApprovalAttachmentKey: vi.fn(),
  cancelOfferDraft: vi.fn(),
  completeOfferSscConfirmation: vi.fn(),
  createOfferDraft: vi.fn(),
  deleteObject: vi.fn(),
  deleteOfferDraft: vi.fn(),
  editOfferDraft: vi.fn(),
  editOfferDraftWithAttachment: vi.fn(),
  getHumanInterviewOfferReadinessError: vi.fn(),
  getObjectStream: vi.fn(),
  invalidateStudioInterviewCaches: vi.fn(),
  isSscCandidateVisible: vi.fn(),
  limit: vi.fn(),
  listOfferDrafts: vi.fn(),
  loadAuthorizedOfferSscContext: vi.fn(),
  loadCurrentOfferSscState: vi.fn(),
  loadDraftById: vi.fn(),
  loadHumanInterviewRoundReadiness: vi.fn(),
  loadOfferApprovalAttachment: vi.fn(),
  maybeAdvanceToOffer: vi.fn(),
  permissionCalls: [] as [string, string][],
  putObjectBytes: vi.fn(),
  receiveOfferSscConfirmation: vi.fn(),
  recordCandidateActivity: vi.fn(),
  removeOfferApprovalAttachment: vi.fn(),
  resolveSscAccessActor: vi.fn(),
  respondOfferDraft: vi.fn(),
  sendOfferDraft: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/access/ssc-access", () => ({
  isSscCandidateVisible: mocks.isSscCandidateVisible,
  resolveSscAccessActor: mocks.resolveSscAccessActor,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  buildOfferApprovalAttachmentKey: mocks.buildOfferApprovalAttachmentKey,
  deleteObject: mocks.deleteObject,
  getObjectStream: mocks.getObjectStream,
  putObjectBytes: mocks.putObjectBytes,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: (resource: string, action: string) => {
    mocks.permissionCalls.push([resource, action]);
    return (_c: unknown, next: () => Promise<void>) => next();
  },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.limit }),
      }),
    }),
  },
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds",
  () => ({
    getHumanInterviewOfferReadinessError: mocks.getHumanInterviewOfferReadinessError,
    loadHumanInterviewRoundReadiness: mocks.loadHumanInterviewRoundReadiness,
  }),
);

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts",
  () => ({
    OfferDraftError: class MockOfferDraftError extends Error {
      override name = "MockOfferDraftError";
      readonly status: 400 | 404;
      constructor(message: string, status: 400 | 404) {
        super(message);
        this.status = status;
      }
    },
    cancelOfferDraft: mocks.cancelOfferDraft,
    completeOfferSscConfirmation: mocks.completeOfferSscConfirmation,
    createOfferDraft: mocks.createOfferDraft,
    deleteOfferDraft: mocks.deleteOfferDraft,
    editOfferDraft: mocks.editOfferDraft,
    editOfferDraftWithAttachment: mocks.editOfferDraftWithAttachment,
    listOfferDrafts: mocks.listOfferDrafts,
    loadAuthorizedOfferSscContext: mocks.loadAuthorizedOfferSscContext,
    loadCurrentOfferSscState: mocks.loadCurrentOfferSscState,
    loadDraftById: mocks.loadDraftById,
    loadOfferApprovalAttachment: mocks.loadOfferApprovalAttachment,
    maybeAdvanceToOffer: mocks.maybeAdvanceToOffer,
    receiveOfferSscConfirmation: mocks.receiveOfferSscConfirmation,
    removeOfferApprovalAttachment: mocks.removeOfferApprovalAttachment,
    respondOfferDraft: mocks.respondOfferDraft,
    sendOfferDraft: mocks.sendOfferDraft,
  }),
);

vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidateStudioInterviewCaches,
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-activity",
  () => ({ recordCandidateActivity: mocks.recordCandidateActivity }),
);

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { offerDraftsRouter } from "../route";

const ORG_ID = "org_offer_routes";
const RECORD_ID = "candidate_offer_routes";

function makeApp() {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: ORG_ID } as never);
      c.set("user", { id: "operator-1" } as never);
      await next();
    })
    .route("/:id/offer-drafts", offerDraftsRouter);
}

describe("offerDraftsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSscAccessActor.mockResolvedValue(null);
    mocks.isSscCandidateVisible.mockResolvedValue(false);
    mocks.buildOfferApprovalAttachmentKey.mockResolvedValue("offer-approval-attachments/file.png");
    mocks.getHumanInterviewOfferReadinessError.mockReturnValue(null);
    mocks.loadHumanInterviewRoundReadiness.mockResolvedValue({
      completedRoundsMissingFeedback: 0,
      failedRounds: 0,
      inconclusiveRounds: 0,
      pendingRounds: 0,
      totalRounds: 1,
    });
  });

  it("does not reveal Offer versions to an SSC outside the current source/Offer gate", async () => {
    mocks.resolveSscAccessActor.mockResolvedValue({ organizationId: ORG_ID, userId: "operator-1" });
    mocks.listOfferDrafts.mockResolvedValue([{ id: "sensitive-offer" }]);
    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "候选人记录不存在。" });
  });

  it("checks the attachment draft's parent instead of trusting an allowed candidate URL", async () => {
    mocks.resolveSscAccessActor.mockResolvedValue({ organizationId: ORG_ID, userId: "operator-1" });
    mocks.isSscCandidateVisible.mockImplementation(({ draftId }: { draftId?: string }) =>
      Promise.resolve(draftId !== "foreign-draft"),
    );
    mocks.loadOfferApprovalAttachment.mockResolvedValue({
      filename: "offer.pdf",
      mediaType: "application/pdf",
      storageKey: "sensitive",
    });
    mocks.getObjectStream.mockResolvedValue({
      body: "sensitive bytes",
      contentType: "application/pdf",
    });
    const response = await makeApp().request(
      `/${RECORD_ID}/offer-drafts/foreign-draft/approval-attachment`,
    );
    expect(response.status).toBe(404);
  });

  it("declares CRUD-specific offer permissions", () => {
    expect(mocks.permissionCalls.every(([resource]) => resource === "offer")).toBe(true);
    const counts: Record<string, number> = {};
    for (const [, action] of mocks.permissionCalls) {
      counts[action] = (counts[action] ?? 0) + 1;
    }
    expect(counts).toEqual({ confirm: 2, create: 2, delete: 2, read: 5, receive: 1, update: 5 });
  });

  it("lists drafts through the mounted candidate path", async () => {
    mocks.listOfferDrafts.mockResolvedValue([{ id: "offer-1" }]);

    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "offer-1" }]);
    expect(mocks.listOfferDrafts).toHaveBeenCalledWith(RECORD_ID, ORG_ID);
  });

  it("blocks offer creation until human interview rounds are ready", async () => {
    mocks.limit.mockResolvedValue([{ id: RECORD_ID, pipelineStage: "human_interview" }]);
    mocks.getHumanInterviewOfferReadinessError.mockReturnValue("请先补全面试评价");

    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts`, {
      body: JSON.stringify({ baseSalary: 30_000, position: "高级前端" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请先补全面试评价" });
    expect(mocks.createOfferDraft).not.toHaveBeenCalled();
  });

  it("rejects immediate sending before saving a JSON Offer", async () => {
    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts`, {
      body: JSON.stringify({ baseSalary: 30_000, position: "工程师", sendImmediately: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(mocks.createOfferDraft).not.toHaveBeenCalled();
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
  });

  it("returns a DAO validation error when a candidate closes after JSON creation preflight", async () => {
    mocks.limit.mockResolvedValue([{ id: RECORD_ID, pipelineStage: "offer" }]);
    mocks.createOfferDraft.mockRejectedValue(
      new OfferDraftError("已结案候选人不能创建 Offer。", 400),
    );
    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts`, {
      body: JSON.stringify({ baseSalary: 30_000, position: "工程师" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "已结案候选人不能创建 Offer。" });
  });

  it.each([
    ["POST", "/with-attachment", "new"],
    ["POST", "/with-attachment", "empty"],
    ["PATCH", "/offer-1/with-attachment", "replace"],
    ["PATCH", "/offer-1/with-attachment", "remove"],
    ["DELETE", "/offer-1/approval-attachment", "delete"],
  ])(
    "retires legacy ODC attachment writes without touching stored data: %s %s (%s)",
    async (method, path, mode) => {
      const form = new FormData();
      form.set("offer", JSON.stringify({ baseSalary: 30_000, position: "工程师" }));
      if (mode === "remove") {
        form.set("removeAttachment", "true");
      } else {
        form.set(
          "file",
          new File([mode === "empty" ? "" : "image"], "legacy.png", { type: "image/png" }),
        );
      }
      const response = await makeApp().request(`/${RECORD_ID}/offer-drafts${path}`, {
        body: method === "DELETE" ? undefined : form,
        method,
      });
      expect(response.status).toBe(410);
      expect(mocks.putObjectBytes).not.toHaveBeenCalled();
      expect(mocks.deleteObject).not.toHaveBeenCalled();
      expect(mocks.createOfferDraft).not.toHaveBeenCalled();
      expect(mocks.editOfferDraftWithAttachment).not.toHaveBeenCalled();
      expect(mocks.removeOfferApprovalAttachment).not.toHaveBeenCalled();
      expect(mocks.recordCandidateActivity).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["historical.png", "image/png", "inline"],
    ["historical.zip", "application/octet-stream", "attachment;"],
  ])(
    "preserves private reads of historical ODC attachments: %s",
    async (filename, mediaType, disposition) => {
      mocks.loadOfferApprovalAttachment.mockResolvedValue({
        filename,
        mediaType,
        size: 3,
        storageKey: "private/historical",
      });
      mocks.getObjectStream.mockResolvedValue({
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
        contentLength: 3,
      });
      const response = await makeApp().request(
        `/${RECORD_ID}/offer-drafts/offer-1/approval-attachment`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Type")).toBe(mediaType);
      expect(response.headers.get("Content-Disposition")).toContain(disposition);
      expect(mocks.loadOfferApprovalAttachment).toHaveBeenCalledWith("offer-1", RECORD_ID, ORG_ID);
    },
  );

  it.each(["header", "stream"])(
    "rejects an oversized screenshot request before form parsing: %s",
    async (mode) => {
      const oversized = 10 * 1024 * 1024 + 64 * 1024 + 1;
      const response = await makeApp().request(
        `/${RECORD_ID}/offer-drafts/offer-1/ssc/complete-with-attachment`,
        {
          body: mode === "header" ? "not parsed" : new Uint8Array(oversized),
          headers: {
            "Content-Type": "application/octet-stream",
            ...(mode === "header" ? { "Content-Length": String(oversized) } : {}),
          },
          method: "POST",
        },
      );
      expect(response.status).toBe(413);
      expect(mocks.putObjectBytes).not.toHaveBeenCalled();
      expect(mocks.completeOfferSscConfirmation).not.toHaveBeenCalled();
    },
  );

  it("preserves audit and cache side effects across offer mutations", async () => {
    const offer = {
      id: "offer-1",
      interviewRecordId: RECORD_ID,
      position: "高级前端",
      version: 1,
    };
    mocks.limit.mockResolvedValue([{ id: RECORD_ID, pipelineStage: "human_interview" }]);
    mocks.createOfferDraft.mockResolvedValue(offer);
    mocks.deleteOfferDraft.mockResolvedValue({ draft: offer, previousStatus: "draft" });
    mocks.editOfferDraft.mockResolvedValue(offer);
    mocks.sendOfferDraft.mockResolvedValue(offer);
    mocks.respondOfferDraft.mockResolvedValue(offer);
    mocks.cancelOfferDraft.mockResolvedValue(offer);
    const app = makeApp();

    const responses = [
      await app.request(`/${RECORD_ID}/offer-drafts`, {
        body: JSON.stringify({ baseSalary: 30_000, position: offer.position }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      await app.request(`/${RECORD_ID}/offer-drafts/${offer.id}`, {
        body: JSON.stringify({ position: offer.position }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      await app.request(`/${RECORD_ID}/offer-drafts/${offer.id}/send`, { method: "POST" }),
      await app.request(`/${RECORD_ID}/offer-drafts/${offer.id}/respond`, {
        body: JSON.stringify({ response: "accepted" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      await app.request(`/${RECORD_ID}/offer-drafts/${offer.id}`, { method: "DELETE" }),
      await app.request(`/${RECORD_ID}/offer-drafts/${offer.id}/cancel`, { method: "POST" }),
    ];

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(mocks.maybeAdvanceToOffer).toHaveBeenCalledWith(RECORD_ID, ORG_ID);
    expect(mocks.recordCandidateActivity.mock.calls.map(([input]) => input.action)).toEqual([
      "offer_draft_created",
      "offer_draft_updated",
      "offer_draft_sent",
      "offer_draft_responded",
      "offer_draft_deleted",
      "offer_draft_cancelled",
    ]);
    expect(mocks.recordCandidateActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "offer_draft_deleted",
        detail: expect.objectContaining({ previousStatus: "draft" }),
      }),
    );
    expect(mocks.invalidateStudioInterviewCaches).toHaveBeenCalledTimes(6);
  });
});
