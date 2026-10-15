import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import type { JobMatchingProfile } from "@arc/db-schema/job-matching";
import { recommendSmartJobs } from "./recommend";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  extract: vi.fn(),
  jobs: vi.fn(),
  rerank: vi.fn(),
}));
vi.mock("./jobs", () => ({ loadEligibleSmartJobs: mocks.jobs }));
vi.mock("./rerank", () => ({ rerankJobDocuments: mocks.rerank }));
vi.mock("../../job-descriptions/utils/matching-profile", () => ({
  ensureJobMatchingProfile: mocks.extract,
  matchingProfileSourceHash: () => "current",
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue", () => ({
  enqueueJobDescriptionIndexJobBestEffort: mocks.enqueue,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer", () => ({
  getResumeSemanticIndexConfig: vi.fn(),
}));

const profile: JobMatchingProfile = {
  domains: [],
  minimumEducation: null,
  minimumWorkYears: null,
  preferredSkills: [],
  requiredSkills: ["React"],
  responsibilities: ["开发前端应用"],
  roleFamily: "前端开发",
  seniority: "高级",
};
const ready = {
  job: {
    description: "负责 React 前端开发",
    id: "ready-job",
    name: "前端工程师",
    prompt: "考察 React 项目经验",
    resumeScreeningPolicy: null,
  },
  matching: {
    confirmedAt: null,
    profile,
    sourceHash: "current",
    updatedAt: new Date("2026-10-15T00:00:00Z"),
  },
};
const missing = {
  job: { ...ready.job, id: "failed-profile-job", name: "画像失败岗位" },
  matching: null,
};
const resume = resumeProfileSchema.parse({
  age: null,
  educationExperiences: [],
  email: null,
  gender: null,
  name: "测试候选人",
  personalStrengths: [],
  phone: null,
  projectExperiences: [],
  schools: [],
  skills: ["React"],
  targetRoles: ["前端工程师"],
  workExperiences: [
    {
      company: "测试公司",
      period: "2020-2026",
      role: "前端工程师",
      summary: "使用 React 开发前端应用",
    },
  ],
  workYears: 6,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.jobs.mockResolvedValue([ready, missing]);
  mocks.extract.mockRejectedValue(new Error("岗位画像缺少 sources 原文依据"));
  mocks.rerank.mockResolvedValue({
    model: "qwen3-rerank",
    results: [{ index: 0, relevance_score: 0.9 }],
    tokens: 100,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("smart job recommendation resilience", () => {
  it("continues reranking valid jobs when one shortlisted profile fails", async () => {
    mocks.extract.mockRejectedValueOnce(
      Object.assign(new Error("岗位画像缺少 sources 原文依据"), {
        modelResponse: { text: "PRIVATE_MODEL_OUTPUT" },
      }),
    );
    const result = await recommendSmartJobs(resume, "org", "uploader");
    expect(result.recommendations.map((job) => job.jobDescriptionId)).toEqual(["ready-job"]);
    expect(result).toMatchObject({ eligibleCount: 2, rerankedCount: 1 });
    expect(mocks.rerank.mock.calls[0]?.[1]).toHaveLength(1);
    expect(JSON.stringify(mocks.rerank.mock.calls)).not.toContain("画像失败岗位");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[smart-resume-upload] job profile unavailable",
      expect.objectContaining({ jobDescriptionId: "failed-profile-job", organizationId: "org" }),
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain("sources");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "PRIVATE_MODEL_OUTPUT",
    );
  });
  it("keeps a task retryable when every shortlisted profile fails", async () => {
    mocks.jobs.mockResolvedValue([missing]);
    await expect(recommendSmartJobs(resume, "org", "uploader")).rejects.toThrow("岗位画像暂不可用");
    expect(mocks.rerank).not.toHaveBeenCalled();
  });
  it("retains confirmed requirements after excluding another failed profile", async () => {
    mocks.jobs.mockResolvedValue([
      ready,
      missing,
      {
        ...ready,
        job: { ...ready.job, id: "requires-more-experience" },
        matching: {
          ...ready.matching,
          confirmedAt: new Date(),
          profile: { ...profile, minimumWorkYears: 10 },
        },
      },
    ]);
    const result = await recommendSmartJobs(resume, "org", "uploader");
    expect(result.recommendations.map((job) => job.jobDescriptionId)).toEqual(["ready-job"]);
    expect(mocks.rerank.mock.calls[0]?.[1]).toHaveLength(1);
  });
  it("still surfaces reranker outages rather than returning a successful empty result", async () => {
    mocks.jobs.mockResolvedValue([ready]);
    mocks.rerank.mockRejectedValueOnce(new Error("reranker unavailable"));
    await expect(recommendSmartJobs(resume, "org", "uploader")).rejects.toThrow(
      "reranker unavailable",
    );
  });
});
