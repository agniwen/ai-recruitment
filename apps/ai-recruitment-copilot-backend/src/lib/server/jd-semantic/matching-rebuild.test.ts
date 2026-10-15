import { beforeEach, expect, it, vi } from "vitest";
import type { buildJobDescriptionSemanticTexts } from "../resume-semantic/text-builders";
import { hashJobDescriptionForSemanticIndex } from "./hash";
import { runJobMatchingIndexRebuild } from "./matching-rebuild";
import type * as indexerModule from "./indexer";

const mocks = vi.hoisted(() => ({ deps: vi.fn(), extract: vi.fn(), set: vi.fn(), where: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { update: () => ({ set: mocks.set }) },
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/utils/matching-profile",
  () => ({ ensureJobMatchingProfile: mocks.extract }),
);
vi.mock("./indexer", async (importOriginal) => {
  const original = await importOriginal<typeof indexerModule>();
  return { ...original, createDefaultJdIndexerDeps: mocks.deps };
});
const job = { organizationId: "org", sourceId: "jd", sourceType: "job_description" as const };
const source = {
  departmentName: "研发",
  description: "前端研发",
  id: "jd",
  name: "前端工程师",
  prompt: "负责 React 开发",
};
const config = {
  apiKey: "key",
  baseUrl: "url",
  dimensions: 2,
  embeddingVersion: "v1",
  model: "embedding",
  qdrantCollectionName: "test",
  qdrantUrl: "http://localhost:6333",
};
const deps = {
  embed: vi.fn(),
  getConfig: () => config,
  loadSource: vi.fn(),
  markFailed: vi.fn(),
  markIndexed: vi.fn(),
  markSkipped: vi.fn(),
  readIndexState: vi.fn(),
  vectorStore: { ensureCollection: vi.fn(), upsertResumeEmbeddings: vi.fn() },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.deps.mockReturnValue(deps);
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.where.mockResolvedValue(null);
  mocks.extract.mockResolvedValue({
    confirmedAt: new Date(),
    profile: { requiredSkills: ["React"], roleFamily: "前端开发" },
  });
  deps.loadSource.mockResolvedValue(source);
  deps.readIndexState.mockResolvedValue({
    profileHash: hashJobDescriptionForSemanticIndex(source),
    status: "indexed",
  });
  deps.embed.mockImplementation(
    ({ chunks }: { chunks: ReturnType<typeof buildJobDescriptionSemanticTexts> }) =>
      Promise.resolve(chunks.map((chunk) => ({ ...chunk, embedding: [1, 2] }))),
  );
});
it("reuses the structured-profile workflow and rewrites vectors even when the DB marker is indexed", async () => {
  await runJobMatchingIndexRebuild(job);
  expect(mocks.extract).toHaveBeenCalledWith({
    description: source.description,
    id: source.id,
    name: source.name,
    prompt: source.prompt,
  });
  expect(deps.readIndexState).not.toHaveBeenCalled();
  expect(deps.embed).toHaveBeenCalledOnce();
  const [[embeddingInput]] = deps.embed.mock.calls;
  expect(embeddingInput.chunks).toHaveLength(3);
  expect(JSON.stringify(embeddingInput.chunks)).toContain("React");
  expect(deps.vectorStore.upsertResumeEmbeddings).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: "org",
      sourceId: "jd",
      sourceType: "job_description",
    }),
  );
  expect(deps.markIndexed).toHaveBeenCalledOnce();
});
it("records profile-extraction failures so a task remains visible and retryable", async () => {
  mocks.extract.mockRejectedValueOnce(new Error("extraction unavailable"));
  await expect(runJobMatchingIndexRebuild(job)).rejects.toThrow("extraction unavailable");
  expect(mocks.set).toHaveBeenCalledWith(
    expect.objectContaining({ errorMessage: "extraction unavailable", status: "failed" }),
  );
  expect(deps.vectorStore.upsertResumeEmbeddings).not.toHaveBeenCalled();
});
it("skips a job that becomes unavailable before its worker runs", async () => {
  deps.loadSource.mockResolvedValue(null);
  await runJobMatchingIndexRebuild(job);
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(deps.markSkipped).toHaveBeenCalledOnce();
  expect(deps.vectorStore.upsertResumeEmbeddings).not.toHaveBeenCalled();
});
it("records worker configuration failures instead of leaving the index pending", async () => {
  mocks.deps.mockImplementationOnce(() => {
    throw new Error("QDRANT_URL is not configured");
  });
  await expect(runJobMatchingIndexRebuild(job)).rejects.toThrow("QDRANT_URL");
  expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
});
