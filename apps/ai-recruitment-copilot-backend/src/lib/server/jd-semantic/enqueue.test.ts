import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbWhere: vi.fn(),
  deleteResumeEmbeddings: vi.fn(),
  enqueueJobs: vi.fn(),
  getConfig: vi.fn(),
  isEnabled: vi.fn(() => false),
  prepareJob: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/embedding", () => ({
  isResumeSemanticIndexEnabled: mocks.isEnabled,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer", () => ({
  getResumeSemanticIndexConfig: mocks.getConfig,
}));

vi.mock("./indexer", () => ({
  prepareJdSemanticIndexJob: mocks.prepareJob,
}));

vi.mock("@arc/resume-parse-queue/resume-semantic-index", () => ({
  enqueueResumeSemanticIndexJobs: mocks.enqueueJobs,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/qdrant/resume-vector-store", () => ({
  QdrantResumeVectorStore: class {
    deleteResumeEmbeddings = mocks.deleteResumeEmbeddings;
  },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { delete: vi.fn(() => ({ where: mocks.dbWhere })) },
}));

describe("enqueueJobDescriptionIndexJobBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled.mockReturnValue(false);
  });

  it("功能未启用 → 静默返回不抛", async () => {
    const { enqueueJobDescriptionIndexJobBestEffort } = await import("./enqueue");
    await expect(
      enqueueJobDescriptionIndexJobBestEffort({
        jobDescriptionId: "jd-1",
        organizationId: "org-1",
      }),
    ).resolves.toBe(false);
  });

  it("jobDescriptionId 为空 → 静默返回", async () => {
    const { enqueueJobDescriptionIndexJobBestEffort } = await import("./enqueue");
    await expect(
      enqueueJobDescriptionIndexJobBestEffort({ jobDescriptionId: null, organizationId: "org-1" }),
    ).resolves.toBe(false);
  });

  it("准备成功且队列写入完成 → 返回 true", async () => {
    mocks.isEnabled.mockReturnValue(true);
    mocks.prepareJob.mockResolvedValue(true);
    mocks.enqueueJobs.mockImplementation(() => Promise.resolve());
    const { enqueueJobDescriptionIndexJobBestEffort } = await import("./enqueue");

    await expect(
      enqueueJobDescriptionIndexJobBestEffort({
        jobDescriptionId: "jd-1",
        organizationId: "org-1",
      }),
    ).resolves.toBe(true);
  });
});

describe("deleteJobDescriptionSemanticIndexBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbWhere.mockImplementation(() => Promise.resolve());
  });

  it("有 qdrantUrl → 删向量 + 删状态行", async () => {
    mocks.getConfig.mockReturnValue({
      dimensions: 8,
      qdrantApiKey: null,
      qdrantCollectionName: "c",
      qdrantUrl: "http://qdrant.local",
    });
    mocks.deleteResumeEmbeddings.mockImplementation(() => Promise.resolve());
    const { deleteJobDescriptionSemanticIndexBestEffort } = await import("./enqueue");

    await expect(
      deleteJobDescriptionSemanticIndexBestEffort({
        jobDescriptionId: "jd-1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.deleteResumeEmbeddings).toHaveBeenCalledWith({
      sourceId: "jd-1",
      sourceType: "job_description",
    });
    expect(mocks.dbWhere).toHaveBeenCalledTimes(1);
  });

  it("无 qdrantUrl → 直接返回不抛，不删向量也不删状态行", async () => {
    mocks.getConfig.mockReturnValue({
      dimensions: 8,
      qdrantApiKey: null,
      qdrantCollectionName: "c",
      qdrantUrl: "",
    });
    const { deleteJobDescriptionSemanticIndexBestEffort } = await import("./enqueue");

    await expect(
      deleteJobDescriptionSemanticIndexBestEffort({
        jobDescriptionId: "jd-1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.deleteResumeEmbeddings).not.toHaveBeenCalled();
    expect(mocks.dbWhere).not.toHaveBeenCalled();
  });

  it("store 抛错 → 被吞掉，console.warn 记录结构化日志", async () => {
    mocks.getConfig.mockReturnValue({
      dimensions: 8,
      qdrantApiKey: null,
      qdrantCollectionName: "c",
      qdrantUrl: "http://qdrant.local",
    });
    mocks.deleteResumeEmbeddings.mockRejectedValue(new Error("boom"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deleteJobDescriptionSemanticIndexBestEffort } = await import("./enqueue");

    await expect(
      deleteJobDescriptionSemanticIndexBestEffort({
        jobDescriptionId: "jd-1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[jd-semantic-index] delete failed",
      expect.objectContaining({ jobDescriptionId: "jd-1" }),
    );
    warnSpy.mockRestore();
  });
});
