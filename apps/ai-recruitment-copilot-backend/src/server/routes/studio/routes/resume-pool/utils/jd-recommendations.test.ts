import { describe, expect, it, vi } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { recommendJobDescriptionsForResume } from "./jd-recommendations";

const profile: ResumeProfile = {
  age: null,
  educationExperiences: [],
  email: "lin@example.com",
  gender: null,
  name: "林一",
  personalStrengths: [],
  phone: "13800000000",
  projectExperiences: [],
  schools: ["浙江大学"],
  skills: ["TypeScript"],
  targetRoles: ["全栈工程师"],
  workExperiences: [],
  workYears: 4,
};

const jdRow = (id: string) => ({
  departmentName: "算法组",
  description: "d",
  id,
  name: `JD-${id}`,
});

const depsWith = (opts: {
  chunks?: unknown[];
  search?: (a: { chunkType: string }) => number;
  displayIds?: string[];
  hitIds?: string[];
  enabled?: boolean;
  embed?: () => Promise<unknown>;
  indexedJdCount?: number;
  jdRecovery?: "empty" | "failed" | "queued";
  reindexQueued?: boolean;
}) => ({
  countIndexedJdVectors: vi.fn(() => Promise.resolve(opts.indexedJdCount ?? 1)),
  embed:
    opts.embed ??
    vi.fn(({ chunks }: { chunks: { chunkType: string }[] }) =>
      Promise.resolve(chunks.map((c) => ({ ...c, embedding: [1, 2] }))),
    ),
  embeddingConfig: { apiKey: "k", baseUrl: "b", dimensions: 2, model: "m" },
  embeddingVersion: "v1",
  enabled: opts.enabled ?? true,
  enqueueJobDescriptionsReindex: vi.fn(() => Promise.resolve(opts.jdRecovery ?? "queued")),
  enqueueResumeReindex: vi.fn(() => Promise.resolve(opts.reindexQueued ?? true)),
  loadJobDescriptionsForDisplay: vi.fn((_org: string, ids: string[]) =>
    Promise.resolve(ids.filter((id) => (opts.displayIds ?? ids).includes(id)).map(jdRow)),
  ),
  loadResumeChunks: vi.fn(() =>
    Promise.resolve(
      opts.chunks ?? [
        { chunkType: "resume_overview", embedding: [1, 2] },
        { chunkType: "skill_role", embedding: [1, 2] },
        { chunkType: "work_project", embedding: [1, 2] },
      ],
    ),
  ),
  vectorStore: {
    searchSimilarResumes: vi.fn(({ chunkType }: { chunkType: string }) =>
      Promise.resolve(
        (opts.hitIds ?? ["jd-1"]).map((id) => ({
          chunkType,
          score: (opts.search ?? (() => 0.9))({ chunkType }),
          sourceId: id,
          sourceType: "job_description" as const,
        })),
      ),
    ),
  },
});

const call = (
  deps: unknown,
  over: Partial<{ jobDescriptionId: string | null; topN: number }> = {},
) =>
  recommendJobDescriptionsForResume(
    {
      actorUserId: "user-1",
      organizationId: "org-1",
      resume: { id: "r-1", jobDescriptionId: over.jobDescriptionId ?? null, profile },
      topN: over.topN ?? 10,
    },
    deps as never,
  );

describe("recommendJobDescriptionsForResume", () => {
  it("加权打分 + ready：skillRole0.9/workProject0.8/resumeOverview0.7 → score 82", async () => {
    const scores: Record<string, number> = {
      resume_overview: 0.7,
      skill_role: 0.9,
      work_project: 0.8,
    };
    const res = await call(depsWith({ search: ({ chunkType }) => scores[chunkType] }));
    expect(res.status).toBe("ready");
    expect(res.recommendations[0]).toMatchObject({ id: "jd-1", score: 82 });
    expect(res.diagnostics.vectorHitCount).toBe(1);
  });

  it("阈值：全 0.2 → recommendations 空，仍为 ready（命中过 0 但被阈值筛掉）", async () => {
    const res = await call(depsWith({ search: () => 0.2 }));
    expect(res.status).toBe("ready");
    expect(res.recommendations).toEqual([]);
    expect(res.diagnostics.vectorHitCount).toBe(1);
    expect(res.diagnostics.eligibleCount).toBe(0);
  });

  it("topN 截断：3 个过阈值 JD，topN=1 只返回 1 个", async () => {
    const deps = depsWith({
      displayIds: ["jd-1", "jd-2", "jd-3"],
      hitIds: ["jd-1", "jd-2", "jd-3"],
    });
    const res = await call(deps, { topN: 1 });
    expect(res.status).toBe("ready");
    expect(res.recommendations).toHaveLength(1);
    expect(res.diagnostics.eligibleCount).toBe(3);
  });

  it("组织隔离：检索带 organizationId + sourceTypes:['job_description']", async () => {
    const deps = depsWith({});
    await call(deps);
    expect(deps.vectorStore.searchSimilarResumes).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", sourceTypes: ["job_description"] }),
    );
  });

  it("删除兜底：向量命中 jd-1/jd-gone，但展示 join 只返回 jd-1 → jd-gone 掉出", async () => {
    const res = await call(depsWith({ displayIds: ["jd-1"], hitIds: ["jd-1", "jd-gone"] }));
    expect(res.status).toBe("ready");
    expect(res.recommendations.map((r) => r.id)).toEqual(["jd-1"]);
    expect(res.diagnostics.vectorHitCount).toBe(1);
  });

  it("已绑定 → already_matched，不检索", async () => {
    const deps = depsWith({});
    const res = await call(deps, { jobDescriptionId: "jd-9" });
    expect(res.status).toBe("already_matched");
    expect(res.recommendations).toEqual([]);
    expect(deps.vectorStore.searchSimilarResumes).not.toHaveBeenCalled();
    expect(deps.loadResumeChunks).not.toHaveBeenCalled();
  });

  it("disabled", async () => {
    const res = await call(depsWith({ enabled: false }));
    expect(res.status).toBe("disabled");
    expect(res.recommendations).toEqual([]);
  });

  it("embed 超时(reject) → indexing，不抛出", async () => {
    const deps = depsWith({ chunks: [], embed: () => Promise.reject(new Error("timeout")) });
    const res = await call(deps);
    expect(res.status).toBe("indexing");
    expect(res.recommendations).toEqual([]);
    expect(deps.enqueueResumeReindex).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "r-1",
    });
  });

  it("现场 embed 回退：chunks 为空但有 profile → 先入队后台补索引，再 embed 后正常检索", async () => {
    const deps = depsWith({ chunks: [] });
    const res = await call(deps);
    expect(deps.enqueueResumeReindex).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "r-1",
    });
    expect(deps.embed).toHaveBeenCalled();
    expect(deps.vectorStore.searchSimilarResumes).toHaveBeenCalled();
    expect(res.status).toBe("ready");
    expect(res.recommendations).toHaveLength(1);
  });

  it("部分 chunk 缺失优雅降级：只有 2 个 chunk（缺 work_project）仍 ready，缺失 facet 记 0", async () => {
    const scores: Record<string, number> = { resume_overview: 0.9, skill_role: 0.95 };
    const deps = depsWith({
      chunks: [
        { chunkType: "resume_overview", embedding: [1, 2] },
        { chunkType: "skill_role", embedding: [1, 2] },
      ],
      search: ({ chunkType }) => scores[chunkType],
    });
    const res = await call(deps);
    expect(res.status).toBe("ready");
    expect(res.recommendations).toHaveLength(1);
    // weightedScore = floor((0.95*0.45 + 0*0.35 + 0.9*0.2)*100) = 60
    expect(res.recommendations[0]).toMatchObject({ id: "jd-1", score: 60 });
    expect(res.recommendations[0]?.similarity.workProject).toBeUndefined();
  });

  it("0 命中 + countIndexedJdVectors=0 + JD 回填已入队 → indexing", async () => {
    const deps = depsWith({ hitIds: [], indexedJdCount: 0 });
    const res = await call(deps);
    expect(deps.countIndexedJdVectors).toHaveBeenCalledWith("org-1", "user-1");
    expect(deps.enqueueJobDescriptionsReindex).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
    });
    expect(res.status).toBe("indexing");
    expect(res.recommendations).toEqual([]);
  });

  it("原始命中均被招聘组范围过滤 + 可见 JD 回填已入队 → indexing", async () => {
    const deps = depsWith({ displayIds: [], hitIds: ["jd-out-of-scope"], indexedJdCount: 0 });
    const res = await call(deps);

    expect(deps.enqueueJobDescriptionsReindex).toHaveBeenCalled();
    expect(res.status).toBe("indexing");
    expect(res.diagnostics.vectorHitCount).toBe(0);
  });

  it("0 命中 + JD 回填入队失败 → disabled", async () => {
    const res = await call(depsWith({ hitIds: [], indexedJdCount: 0, jdRecovery: "failed" }));
    expect(res.status).toBe("disabled");
  });

  it("0 命中 + 当前范围没有 JD → ready 空", async () => {
    const res = await call(depsWith({ hitIds: [], indexedJdCount: 0, jdRecovery: "empty" }));
    expect(res.status).toBe("ready");
    expect(res.recommendations).toEqual([]);
  });

  it("indexing(b) 反例：0 命中 + countIndexedJdVectors>0 → ready 空（确实无匹配）", async () => {
    const deps = depsWith({ hitIds: [], indexedJdCount: 5 });
    const res = await call(deps);
    expect(deps.countIndexedJdVectors).toHaveBeenCalledWith("org-1", "user-1");
    expect(res.status).toBe("ready");
    expect(res.recommendations).toEqual([]);
  });

  it("补索引实际未入队 + embed 超时 → disabled（出口态收敛，不再死循环）", async () => {
    const deps = depsWith({
      chunks: [],
      embed: () => Promise.reject(new Error("timeout")),
      reindexQueued: false,
    });
    const res = await call(deps);
    expect(res.status).toBe("disabled");
    expect(res.recommendations).toEqual([]);
  });
});
