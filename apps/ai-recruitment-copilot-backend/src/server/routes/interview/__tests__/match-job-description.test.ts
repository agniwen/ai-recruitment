import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { describe, expect, it, vi } from "vitest";
import { resolveJobDescriptionMatchBestEffort } from "@arc/ai-recruitment-copilot-backend/server/routes/interview/match-job-description";

const resumeProfile: ResumeProfile = {
  age: null,
  email: "candidate@example.com",
  gender: null,
  name: "候选人甲",
  personalStrengths: [],
  phone: "13800138000",
  projectExperiences: [],
  schools: [],
  skills: ["React"],
  targetRoles: ["前端工程师"],
  workExperiences: [],
  workYears: 5,
};

const jobDescriptions: JobDescriptionListRecord[] = [
  {
    allowCrossDepartmentInterviewers: false,
    code: null,
    controlCategory: null,
    createdAt: new Date("2026-06-20T00:00:00.000Z"),
    createdBy: "user-1",
    departmentId: "department-1",
    departmentName: "研发部",
    description: "负责 Web 前端研发。",
    expectedOnboardDate: null,
    gapCount: null,
    headcount: null,
    id: "jd-1",
    interviewerIds: [],
    interviewers: [],
    jobLevel: null,
    jobSeries: null,
    name: "前端工程师",
    notes: null,
    offeredPendingOnboardCount: null,
    onboardedCount: null,
    presetQuestions: [],
    priority: null,
    prompt: "请考察前端能力。",
    recruitmentStatus: null,
    requestedDate: null,
    requester: null,
    resumeContact: null,
    resumeCount: 0,
    salaryCurrency: null,
    salaryMaxAmount: null,
    salaryMinAmount: null,
    serviceUnit: null,
    sourceSheet: null,
    updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    workLocation: null,
  },
];

describe("resolveJobDescriptionMatchBestEffort", () => {
  it("falls back to no match when the AI matcher connection is reset", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await resolveJobDescriptionMatchBestEffort({
      jobDescriptions,
      matcher: vi.fn().mockRejectedValue(new Error("socket hang up")),
      resumeProfile,
    });

    expect(result).toEqual({ matchedId: null, reason: null });
    expect(warnSpy).toHaveBeenCalledWith(
      "[match-job-description] best-effort match failed",
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it("returns the matched job description when the AI matcher succeeds", async () => {
    const result = await resolveJobDescriptionMatchBestEffort({
      jobDescriptions,
      matcher: vi
        .fn()
        .mockResolvedValue({ jobDescriptionId: "jd-1", reason: "技能与岗位要求匹配。" }),
      resumeProfile,
    });

    expect(result).toEqual({ matchedId: "jd-1", reason: "技能与岗位要求匹配。" });
  });
});
