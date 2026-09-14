import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelled: vi.fn(),
  claim: vi.fn(),
  createPool: vi.fn(),
  enqueueIndex: vi.fn(),
  enqueuePoolReview: vi.fn(),
  enqueueReview: vi.fn(),
  getObjectStream: vi.fn(),
  loadDetail: vi.fn(),
  markPoolParsed: vi.fn(),
  parse: vi.fn(),
  release: vi.fn(),
  set: vi.fn(),
  syncSkills: vi.fn(),
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
  parseResumeBytesToProfile: mocks.parse,
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
  createResumePoolItem: mocks.createPool,
  markResumePoolItemParsed: mocks.markPoolParsed,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/create-from-storage",
  () => ({ createResumeRecordFromStorage: vi.fn(() => ({})) }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/skills",
  () => ({ syncResumeSkills: mocks.syncSkills }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue", () => ({
  enqueueResumeSemanticIndexJobBestEffort: mocks.enqueueIndex,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/review-queue",
  () => ({
    enqueueResumePoolReviewGenerationBestEffort: mocks.enqueuePoolReview,
    enqueueResumeReviewGenerationForRecordBestEffort: mocks.enqueueReview,
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
    target: "resume_library",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({
      attemptCount: 1,
      batchId: "batch",
      contentHash: "hash",
      id: "item",
      originalFileName: "resume.pdf",
      poolItemId: "private-copy",
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
  it("reuses one parse result for the candidate and its private copy across a retry", async () => {
    const resumeProfile = { name: "候选人", skills: ["TypeScript"], targetRoles: ["工程师"] };
    mocks.getObjectStream.mockImplementation(() => ({
      body: new Blob(["resume"]),
      contentType: "application/pdf",
    }));
    mocks.parse.mockResolvedValue({ parsedText: "parsed resume", resumeProfile });
    mocks.enqueueIndex.mockResolvedValue(true);
    mocks.enqueueReview.mockResolvedValue(true);
    mocks.markPoolParsed.mockImplementation(() => Promise.resolve());

    await processBatchItem("item", { bypassCache: true });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ resumeProfile, resumeText: "parsed resume" }),
    );
    expect(mocks.markPoolParsed).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user",
        organizationId: "org",
        poolItemId: "private-copy",
        resumeParseStatus: "ready",
        resumeProfile,
        resumeText: "parsed resume",
      }),
      mocks.syncSkills.mock.calls[0][0],
    );
    expect(mocks.enqueueIndex).toHaveBeenCalledWith({
      organizationId: "org",
      sourceId: "private-copy",
      sourceType: "resume_pool_item",
    });
    expect(mocks.enqueuePoolReview).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        poolItemId: "private-copy",
        resumeRecordId: "record",
        status: "succeeded",
      }),
    );

    await processBatchItem("item", { bypassCache: true });
    expect(mocks.markPoolParsed).toHaveBeenCalledTimes(2);
    expect(mocks.createPool).not.toHaveBeenCalled();
  });
  it("rejects the shared transaction and skips enrichment when the private copy update fails", async () => {
    mocks.getObjectStream.mockImplementation(() => ({ body: new Blob(["resume"]) }));
    mocks.parse.mockResolvedValue({ parsedText: "text", resumeProfile: { name: "候选人" } });
    const error = new Error("private copy update failed");
    mocks.markPoolParsed.mockRejectedValueOnce(error);
    // Model the transaction boundary: its rejection is what makes the DB roll back all writes.
    mocks.transaction.mockImplementation((run) =>
      run({
        insert: () => ({ values: mocks.values }),
        select: () => ({ from: () => ({ where: () => ({ limit: () => [batch] }) }) }),
        update: () => ({ set: mocks.set }),
      }),
    );
    await expect(
      processBatchItem("item", { bypassCache: true, retryParseFailure: true }),
    ).rejects.toThrow(error);
    expect(mocks.markPoolParsed.mock.calls[0][1]).toBe(mocks.syncSkills.mock.calls[0][0]);
    const transactions = await Promise.allSettled(
      mocks.transaction.mock.results.map((result) => result.value),
    );
    expect(transactions).toContainEqual({ reason: error, status: "rejected" });
    expect(mocks.enqueueIndex).not.toHaveBeenCalled();
    expect(mocks.enqueueReview).not.toHaveBeenCalled();
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
