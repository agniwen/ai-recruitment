import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelled: vi.fn(),
  claim: vi.fn(),
  getObjectStream: vi.fn(),
  loadDetail: vi.fn(),
  release: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
  values: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  getObjectStream: mocks.getObjectStream,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches",
  () => ({
    claimNextPendingItem: vi.fn(),
    claimPendingItemById: mocks.claim,
    loadBatchDetail: mocks.loadDetail,
    reconcileBatchProgress: vi.fn(),
    toBatchDto: vi.fn(),
    toItemDto: vi.fn(),
  }),
);
vi.mock("./processor-claims", () => ({
  assertBatchItemNotCancelled: vi.fn(),
  getClaimMissRetryError: vi.fn(),
  isBatchItemCancelled: mocks.cancelled,
  isBatchItemCancelledError: (error: Error) => error.name === "BatchItemCancelledError",
  loadClaimMissSnapshot: vi.fn(),
  releaseBatchItemForRetry: mocks.release,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/resume-analysis-agent", () => ({
  parseResumeBytesToProfile: vi.fn(() => ({})),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/historical-attempts",
  () => ({
    finishHistoricalImportAttempt: vi.fn(() => ({})),
    setHistoricalImportAttemptStep: vi.fn(() => ({})),
    startHistoricalImportAttempt: vi.fn(() => ({})),
  }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/chat/dao/chat-attachments", () => ({
  findAttachmentByStorageKey: vi.fn(() => ({})),
  updateParseResultByHash: vi.fn(() => ({})),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao",
  () => ({ loadJobDescriptionById: vi.fn(() => ({})) }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-pool/dao", () => ({
  createResumePoolItem: vi.fn(() => ({})),
  markResumePoolItemParsed: vi.fn(() => ({})),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/create-from-storage",
  () => ({ createResumeRecordFromStorage: vi.fn(() => ({})) }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/skills",
  () => ({ syncResumeSkills: vi.fn(() => ({})) }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue", () => ({
  enqueueResumeSemanticIndexJobBestEffort: vi.fn(() => ({})),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/review-queue",
  () => ({
    enqueueResumePoolReviewGenerationBestEffort: vi.fn(() => ({})),
    enqueueResumeReviewGenerationForRecordBestEffort: vi.fn(() => ({})),
  }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/qwen-ocr", () => ({
  getQwenOcrEndpointConfig: vi.fn(() => ({})),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/mastra/models", () => ({
  getResumeStructuredModelEndpoint: vi.fn(() => ({})),
}));

const { processBatchItem } = await import("./processor");

describe("ordinary parse failure lifecycle", () => {
  const batch = {
    createdBy: "user",
    id: "batch",
    jdMode: "none",
    organizationId: "org",
    status: "processing",
    target: "library",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({
      attemptCount: 1,
      batchId: "batch",
      id: "item",
      resumeRecordId: "record",
      storageKey: "file",
    });
    mocks.set.mockReturnValue({ where: vi.fn().mockResolvedValue(null) });
    mocks.transaction.mockImplementation((run) =>
      run({
        insert: () => ({ values: mocks.values }),
        select: () => ({ from: () => ({ where: () => ({ limit: () => [batch] }) }) }),
        update: () => ({ set: mocks.set }),
      }),
    );
    mocks.loadDetail.mockResolvedValue({ batch, items: [{ id: "item", status: "failed" }] });
    mocks.cancelled.mockResolvedValue(false);
    mocks.getObjectStream.mockRejectedValue(new Error("parse timeout"));
  });
  it("releases a recoverable upload for the next queue attempt without writing terminal failure", async () => {
    await expect(
      processBatchItem("item", { bypassCache: true, retryParseFailure: true }),
    ).rejects.toThrow("parse timeout");
    expect(mocks.release).toHaveBeenCalledWith("batch", "item");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("writes terminal failure after attempts are exhausted", async () => {
    await processBatchItem("item", { bypassCache: true, retryParseFailure: false });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: "parse timeout", status: "failed" }),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ resumeParseStatus: "failed" }),
    );
  });
  it("keeps cancellation terminal instead of scheduling another parse", async () => {
    mocks.getObjectStream.mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "BatchItemCancelledError" }),
    );
    await processBatchItem("item", { bypassCache: true, retryParseFailure: true });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
