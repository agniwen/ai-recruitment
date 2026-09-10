import { describe, expect, it, vi } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { createResumeReviewWorkflow } from "../workflows/resume-review-workflow";
const PROFILE: ResumeProfile = {
  age: null,
  educationExperiences: [],
  email: "candidate@example.com",
  gender: null,
  name: "候选人",
  personalStrengths: ["前端工程化"],
  phone: null,
  projectExperiences: [],
  schools: [],
  skills: ["TypeScript", "React"],
  targetRoles: ["前端工程师"],
  workExperiences: [],
  workYears: 5,
};

describe("single-call resume review workflow", () => {
  it("invokes generation once and propagates provider failure without a second scoring step", async () => {
    const generateReview = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const workflow = createResumeReviewWorkflow({ generateReview });
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: { jobDescription: "React 岗位", resumeProfile: PROFILE, resumeText: "原文" },
    });
    expect(result.status).toBe("failed");
    expect(generateReview).toHaveBeenCalledTimes(1);
    expect(generateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        jobDescription: "React 岗位",
        resumeProfile: PROFILE,
        resumeText: "原文",
      }),
    );
  });
});
