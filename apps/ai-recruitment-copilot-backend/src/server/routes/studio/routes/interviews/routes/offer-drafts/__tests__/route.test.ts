import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

const mocks = vi.hoisted(() => ({
  buildOfferApprovalAttachmentKey: vi.fn(),
  cancelOfferDraft: vi.fn(),
  createOfferDraft: vi.fn(),
  deleteObject: vi.fn(),
  deleteOfferDraft: vi.fn(),
  editOfferDraft: vi.fn(),
  editOfferDraftWithAttachment: vi.fn(),
  getHumanInterviewOfferReadinessError: vi.fn(),
  getObjectStream: vi.fn(),
  invalidateStudioInterviewCaches: vi.fn(),
  limit: vi.fn(),
  listOfferDrafts: vi.fn(),
  loadDraftById: vi.fn(),
  loadHumanInterviewRoundReadiness: vi.fn(),
  loadOfferApprovalAttachment: vi.fn(),
  maybeAdvanceToOffer: vi.fn(),
  permissionCalls: [] as [string, string][],
  putObjectBytes: vi.fn(),
  recordCandidateActivity: vi.fn(),
  removeOfferApprovalAttachment: vi.fn(),
  respondOfferDraft: vi.fn(),
  sendOfferDraft: vi.fn(),
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
    OfferDraftError: class OfferDraftError extends Error {
      override name = "OfferDraftError";
    },
    cancelOfferDraft: mocks.cancelOfferDraft,
    createOfferDraft: mocks.createOfferDraft,
    deleteOfferDraft: mocks.deleteOfferDraft,
    editOfferDraft: mocks.editOfferDraft,
    editOfferDraftWithAttachment: mocks.editOfferDraftWithAttachment,
    listOfferDrafts: mocks.listOfferDrafts,
    loadDraftById: mocks.loadDraftById,
    loadOfferApprovalAttachment: mocks.loadOfferApprovalAttachment,
    maybeAdvanceToOffer: mocks.maybeAdvanceToOffer,
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

  it("declares CRUD-specific offer permissions", () => {
    expect(mocks.permissionCalls).toEqual([
      ["offer", "read"],
      ["offer", "create"],
      ["offer", "create"],
      ["offer", "read"],
      ["offer", "update"],
      ["offer", "update"],
      ["offer", "update"],
      ["offer", "update"],
      ["offer", "update"],
      ["offer", "delete"],
      ["offer", "delete"],
    ]);
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

  it("stores a selected image on the created Offer and serves it to readers", async () => {
    const offer = {
      approvalAttachment: { filename: "ssc.png", mediaType: "image/png", size: 3 },
      id: "offer-1",
      interviewRecordId: RECORD_ID,
      position: "高级前端",
      version: 1,
    };
    mocks.limit.mockResolvedValue([{ id: RECORD_ID, pipelineStage: "offer" }]);
    mocks.createOfferDraft.mockResolvedValue(offer);
    mocks.loadOfferApprovalAttachment.mockResolvedValue({
      ...offer.approvalAttachment,
      storageKey: "offer-approval-attachments/file.png",
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
    const form = new FormData();
    form.set("offer", JSON.stringify({ baseSalary: 30_000, position: offer.position }));
    form.set("file", new File([new Uint8Array([1, 2, 3])], "ssc.png", { type: "image/png" }));

    const created = await makeApp().request(`/${RECORD_ID}/offer-drafts/with-attachment`, {
      body: form,
      method: "POST",
    });

    expect(created.status).toBe(200);
    expect(mocks.createOfferDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalAttachment: {
          filename: "ssc.png",
          mediaType: "image/png",
          size: 3,
          storageKey: "offer-approval-attachments/file.png",
        },
        interviewRecordId: RECORD_ID,
        organizationId: ORG_ID,
      }),
    );
    const response = await makeApp().request(
      `/${RECORD_ID}/offer-drafts/offer-1/approval-attachment`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(mocks.loadOfferApprovalAttachment).toHaveBeenCalledWith("offer-1", RECORD_ID, ORG_ID);
  });

  it("keeps zip attachments downloadable", async () => {
    mocks.limit.mockResolvedValue([{ id: RECORD_ID, pipelineStage: "offer" }]);
    mocks.createOfferDraft.mockResolvedValue({ id: "offer-zip", position: "工程师", version: 2 });
    mocks.loadOfferApprovalAttachment.mockResolvedValue({
      filename: "ssc-review.zip",
      mediaType: "application/octet-stream",
      size: 3,
      storageKey: "offer-approval-attachments/file.zip",
    });
    mocks.getObjectStream.mockResolvedValue({
      body: new ReadableStream({ start: (controller) => controller.close() }),
    });
    const form = new FormData();
    form.set("offer", JSON.stringify({ baseSalary: 30_000, position: "工程师" }));
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "ssc-review.zip", { type: "application/zip" }),
    );

    const created = await makeApp().request(`/${RECORD_ID}/offer-drafts/with-attachment`, {
      body: form,
      method: "POST",
    });
    expect(created.status).toBe(200);
    expect(mocks.createOfferDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalAttachment: expect.objectContaining({
          filename: "ssc-review.zip",
          mediaType: "application/octet-stream",
        }),
      }),
    );

    const response = await makeApp().request(
      `/${RECORD_ID}/offer-drafts/offer-zip/approval-attachment`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("rejects empty approval attachments before creating an Offer", async () => {
    const form = new FormData();
    form.set("offer", JSON.stringify({ baseSalary: 30_000, position: "高级前端" }));
    form.set("file", new File([], "empty.zip", { type: "application/zip" }));

    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts/with-attachment`, {
      body: form,
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(mocks.createOfferDraft).not.toHaveBeenCalled();
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
  });

  it("removes a saved attachment within the current candidate and organization", async () => {
    const attachment = {
      filename: "ssc.png",
      mediaType: "image/png",
      size: 3,
      storageKey: "offer-approval-attachments/file.png",
    };
    mocks.removeOfferApprovalAttachment.mockResolvedValue(attachment);

    const response = await makeApp().request(
      `/${RECORD_ID}/offer-drafts/offer-1/approval-attachment`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(mocks.removeOfferApprovalAttachment).toHaveBeenCalledWith("offer-1", RECORD_ID, ORG_ID);
    expect(mocks.deleteObject).toHaveBeenCalledWith(attachment.storageKey);
    expect(mocks.recordCandidateActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "offer_draft_updated",
        detail: { approvalAttachmentRemoved: true, draftId: "offer-1", filename: "ssc.png" },
        interviewRecordId: RECORD_ID,
        organizationId: ORG_ID,
      }),
    );
    expect(mocks.invalidateStudioInterviewCaches).toHaveBeenCalledWith(ORG_ID);
  });

  it("returns 404 when the saved attachment does not exist", async () => {
    mocks.removeOfferApprovalAttachment.mockResolvedValue(null);

    const response = await makeApp().request(
      `/${RECORD_ID}/offer-drafts/offer-1/approval-attachment`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.recordCandidateActivity).not.toHaveBeenCalled();
  });

  it("replaces an attachment together with edited Offer fields", async () => {
    const previousAttachment = {
      filename: "old.png",
      mediaType: "image/png",
      size: 3,
      storageKey: "offer-approval-attachments/old.png",
    };
    mocks.loadDraftById.mockResolvedValue({ id: "offer-1", interviewRecordId: RECORD_ID });
    mocks.editOfferDraftWithAttachment.mockResolvedValue({
      previousAttachment,
      updated: { id: "offer-1", interviewRecordId: RECORD_ID, position: "新职位", version: 1 },
    });
    const form = new FormData();
    form.set("offer", JSON.stringify({ baseSalary: 31_000, position: "新职位" }));
    form.set("file", new File(["new"], "new.png", { type: "image/png" }));

    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts/offer-1/with-attachment`, {
      body: form,
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.editOfferDraftWithAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalAttachment: expect.objectContaining({ filename: "new.png" }),
        draftId: "offer-1",
        input: expect.objectContaining({ baseSalary: 31_000, position: "新职位" }),
        organizationId: ORG_ID,
      }),
    );
    expect(mocks.deleteObject).toHaveBeenCalledWith(previousAttachment.storageKey);
  });

  it("removes an attachment when saving the edited Offer", async () => {
    mocks.loadDraftById.mockResolvedValue({ id: "offer-1", interviewRecordId: RECORD_ID });
    mocks.editOfferDraftWithAttachment.mockResolvedValue({
      previousAttachment: { storageKey: "offer-approval-attachments/old.png" },
      updated: { id: "offer-1", interviewRecordId: RECORD_ID, position: "工程师", version: 1 },
    });
    const form = new FormData();
    form.set("offer", JSON.stringify({ baseSalary: 30_000, position: "工程师" }));
    form.set("removeAttachment", "true");

    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts/offer-1/with-attachment`, {
      body: form,
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.editOfferDraftWithAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ approvalAttachment: null }),
    );
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
  });

  it("cleans up a replacement upload if editing the draft fails", async () => {
    mocks.loadDraftById.mockResolvedValue({ id: "offer-1", interviewRecordId: RECORD_ID });
    mocks.editOfferDraftWithAttachment.mockRejectedValue(new Error("database unavailable"));
    const form = new FormData();
    form.set("offer", JSON.stringify({ baseSalary: 30_000, position: "工程师" }));
    form.set("file", new File(["new"], "new.png", { type: "image/png" }));

    const response = await makeApp().request(`/${RECORD_ID}/offer-drafts/offer-1/with-attachment`, {
      body: form,
      method: "PATCH",
    });
    expect(response.status).toBe(500);
    expect(mocks.deleteObject).toHaveBeenCalledWith("offer-approval-attachments/file.png");
  });

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
