import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateResumeReview: vi.fn(),
  generateResumeScreeningResult: vi.fn(),
  loadJobDescriptionById: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/resume-analysis-agent", () => ({
  generateResumeReview: mocks.generateResumeReview,
  generateResumeScreeningResult: mocks.generateResumeScreeningResult,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao",
  () => ({
    loadJobDescriptionById: mocks.loadJobDescriptionById,
  }),
);

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { generateResumeReviewBestEffort } from "./review-generation";

const RESUME_PROFILE: ResumeProfile = {
  age: null,
  educationExperiences: [],
  email: null,
  gender: null,
  name: "候选人",
  personalStrengths: [],
  phone: null,
  projectExperiences: [],
  schools: [],
  skills: ["React"],
  targetRoles: ["前端工程师"],
  workExperiences: [],
  workYears: null,
};

describe("generateResumeReviewBestEffort", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      fn.mockReset();
    }
  });

  it("passes job text into one generation without evaluating configured rules", async () => {
    const structuredReview = { overall: { baseScore: 86 } };
    mocks.loadJobDescriptionById.mockResolvedValue({
      description: "负责 Web 端研发",
      name: "前端工程师",
      prompt: "需要 React 经验",
      resumeScreeningPolicy: { enabled: true, rules: [], version: 1 },
    });
    mocks.generateResumeScreeningResult.mockResolvedValue({
      policyEmpty: true,
      policyEnabled: true,
      policyHash: "hash",
      policyVersion: 1,
      recommendation: "pass",
      ruleResults: [],
    });
    mocks.generateResumeReview.mockResolvedValue({
      review: "评价 markdown",
      screeningResult: null,
      structuredReview,
    });

    const result = await generateResumeReviewBestEffort({
      jobDescriptionId: "jd-1",
      organizationId: "org-1",
      resumeProfile: RESUME_PROFILE,
    });

    expect(result?.structuredReview).toBe(structuredReview);
    expect(result?.screeningResult).toBeNull();
    expect(mocks.generateResumeScreeningResult).not.toHaveBeenCalled();
    expect(mocks.generateResumeReview).toHaveBeenCalledTimes(1);
    expect(mocks.loadJobDescriptionById).toHaveBeenCalledWith("org-1", "jd-1");
    expect(mocks.generateResumeReview).toHaveBeenCalledWith({
      jobDescription:
        "岗位名称：前端工程师\n\n岗位描述：负责 Web 端研发\n\n岗位 Prompt：\n需要 React 经验",
      resumeProfile: RESUME_PROFILE,
      resumeText: undefined,
    });
  });

  it("returns null when review generation fails", async () => {
    mocks.loadJobDescriptionById.mockResolvedValue(null);
    mocks.generateResumeScreeningResult.mockResolvedValue({
      policyEmpty: true,
      policyEnabled: false,
      policyHash: null,
      policyVersion: null,
      recommendation: "pass",
      ruleResults: [],
    });
    mocks.generateResumeReview.mockRejectedValue(new Error("model unavailable"));

    const result = await generateResumeReviewBestEffort({
      jobDescriptionId: "jd-1",
      organizationId: "org-1",
      resumeProfile: RESUME_PROFILE,
    });

    expect(result).toBeNull();
  });
});
