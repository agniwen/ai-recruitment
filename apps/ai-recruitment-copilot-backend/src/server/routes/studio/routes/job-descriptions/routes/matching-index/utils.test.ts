import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJobMatchingIndexStatus, startJobMatchingIndexRebuild } from "./utils";

const mocks = vi.hoisted(() => ({
  collectionExists: vi.fn(),
  count: vi.fn(),
  enabled: vi.fn(),
  enqueue: vi.fn(),
  ensureCollection: vi.fn(),
  failed: vi.fn(),
  pending: vi.fn(),
  queueConfigured: vi.fn(),
  rows: vi.fn(),
}));
vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: class {
    collectionExists = mocks.collectionExists;
    count = mocks.count;
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/qdrant/resume-vector-store", () => ({
  QdrantResumeVectorStore: function createStore() {
    return { ensureCollection: mocks.ensureCollection };
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/embedding", () => ({
  isResumeSemanticIndexEnabled: mocks.enabled,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer", () => ({
  getResumeSemanticIndexConfig: () => ({
    apiKey: "test-key",
    dimensions: 2,
    embeddingVersion: "v1",
    model: "embedding",
    qdrantCollectionName: "test",
    qdrantUrl: "http://localhost:6333",
  }),
}));
vi.mock("@arc/resume-parse-queue/resume-semantic-index", () => ({
  enqueueResumeSemanticIndexJobs: mocks.enqueue,
}));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  isResumeParseQueueConfigured: mocks.queueConfigured,
}));
vi.mock("./dao", () => ({
  jobMatchingIndexHash: (row: { job: { id: string } }) => `${row.job.id}-hash`,
  loadJobMatchingIndexRows: mocks.rows,
  markJobMatchingEnqueueFailed: mocks.failed,
  markJobMatchingIndexesPending: mocks.pending,
}));
const rows = [
  { indexHash: "job-a-hash", indexStatus: "indexed", job: { id: "job-a" }, profile: {} },
  { indexHash: null, indexStatus: null, job: { id: "job-b" }, profile: null },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.mockResolvedValue(rows);
  mocks.enabled.mockReturnValue(true);
  mocks.queueConfigured.mockReturnValue(true);
  mocks.collectionExists.mockResolvedValue({ exists: true });
  mocks.count.mockResolvedValue({ count: 0 });
  mocks.enqueue.mockResolvedValue(null);
});
describe("job index maintenance", () => {
  it("reads real Qdrant points independently from copied database index markers", async () => {
    const status = await getJobMatchingIndexStatus("org");
    expect(status).toMatchObject({ indexed: 1, profiles: 1, total: 2, vectorPoints: 0 });
    expect(mocks.count).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        filter: {
          must: expect.arrayContaining([
            { key: "organizationId", match: { value: "org" } },
            { key: "sourceId", match: { any: ["job-a", "job-b"] } },
          ]),
        },
      }),
    );
  });
  it("reports an absent collection as zero without attempting an invalid count", async () => {
    mocks.collectionExists.mockResolvedValue({ exists: false });
    const status = await getJobMatchingIndexStatus("org");
    expect(status.vectorPoints).toBe(0);
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it("reports unavailable vector data as unknown rather than zero", async () => {
    mocks.collectionExists.mockRejectedValue(new Error("offline"));
    const status = await getJobMatchingIndexStatus("org");
    expect(status.vectorPoints).toBeNull();
    expect(status.vectorError).toContain("无法读取");
  });
  it("queues a forced rebuild for every selectable job, including already-indexed jobs", async () => {
    expect(await startJobMatchingIndexRebuild("org")).toEqual({ queued: 2 });
    expect(mocks.ensureCollection).toHaveBeenCalledOnce();
    expect(mocks.pending).toHaveBeenCalledWith(
      "org",
      rows,
      expect.objectContaining({ embeddingVersion: "v1" }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      ["job-a", "job-b"].map((sourceId) => ({
        organizationId: "org",
        rebuildJobMatching: true,
        sourceId,
        sourceType: "job_description",
      })),
    );
  });
  it("retries only failed jobs in the current workspace and embedding version", async () => {
    const failedRows = [
      { indexStatus: "failed", job: { id: "failed-profile" }, profile: null },
      { indexStatus: "failed", job: { id: "failed-vector" }, profile: {} },
    ];
    mocks.rows.mockResolvedValue([
      ...rows,
      { indexStatus: "pending", job: { id: "running" }, profile: {} },
      ...failedRows,
    ]);
    expect(await startJobMatchingIndexRebuild("org", { failedOnly: true })).toEqual({
      queued: 2,
    });
    expect(mocks.rows).toHaveBeenCalledWith("org", "v1");
    expect(mocks.pending).toHaveBeenCalledWith(
      "org",
      failedRows,
      expect.objectContaining({ embeddingVersion: "v1" }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      failedRows.map(({ job }) => ({
        organizationId: "org",
        rebuildJobMatching: true,
        sourceId: job.id,
        sourceType: "job_description",
      })),
    );
  });
  it("does not fall back to a full rebuild when no failed jobs remain", async () => {
    expect(await startJobMatchingIndexRebuild("org", { failedOnly: true })).toEqual({
      queued: 0,
    });
    expect(mocks.ensureCollection).not.toHaveBeenCalled();
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("records an enqueue failure only for the jobs selected for retry", async () => {
    mocks.rows.mockResolvedValue([
      ...rows,
      { indexStatus: "failed", job: { id: "failed-job" }, profile: null },
    ]);
    mocks.enqueue.mockRejectedValue(new Error("offline"));
    await expect(startJobMatchingIndexRebuild("org", { failedOnly: true })).rejects.toThrow(
      "offline",
    );
    expect(mocks.failed).toHaveBeenCalledWith("org", ["failed-job"], "v1");
  });
  it("rejects disabled or unconfigured queues before changing index state", async () => {
    mocks.queueConfigured.mockReturnValue(false);
    await expect(startJobMatchingIndexRebuild("org")).rejects.toThrow("队列");
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("retains enqueue failures for retry rather than leaving false pending state", async () => {
    mocks.enqueue.mockRejectedValue(new Error("offline"));
    await expect(startJobMatchingIndexRebuild("org")).rejects.toThrow("offline");
    expect(mocks.failed).toHaveBeenCalledWith("org", ["job-a", "job-b"], "v1");
  });
});
