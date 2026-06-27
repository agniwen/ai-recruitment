import { describe, expect, it } from "vitest";
import { jobDescriptionFormSchema } from "../job-descriptions";

const baseJobDescription = {
  allowCrossDepartmentInterviewers: false,
  departmentId: "dept-1",
  description: "",
  interviewerIds: ["interviewer-1"],
  name: "前端工程师",
  prompt: "岗位职责和任职要求",
};

describe("jobDescriptionFormSchema salary fields", () => {
  it("allows salary fields to be omitted", () => {
    const result = jobDescriptionFormSchema.safeParse(baseJobDescription);

    expect(result.success).toBe(true);
  });

  it("accepts an equal min and max salary range", () => {
    const result = jobDescriptionFormSchema.safeParse({
      ...baseJobDescription,
      salaryCurrency: "CNY",
      salaryMaxAmount: 4000,
      salaryMinAmount: 4000,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a salary max below the min", () => {
    const result = jobDescriptionFormSchema.safeParse({
      ...baseJobDescription,
      salaryCurrency: "CNY",
      salaryMaxAmount: 3999,
      salaryMinAmount: 4000,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["salaryMaxAmount"]);
  });

  it("requires the complete salary range when any salary field is present", () => {
    const result = jobDescriptionFormSchema.safeParse({
      ...baseJobDescription,
      salaryCurrency: "CNY",
      salaryMinAmount: 4000,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(["salaryMaxAmount"]);
  });
});

describe("jobDescriptionFormSchema recruitment demand fields", () => {
  it("preserves optional recruitment demand fields", () => {
    const result = jobDescriptionFormSchema.safeParse({
      ...baseJobDescription,
      controlCategory: "C类-正常招聘",
      expectedOnboardDate: "2026-06-01",
      gapCount: 1,
      headcount: 2,
      jobLevel: "P3",
      jobSeries: "直属",
      notes: "台湾本地驻场办公",
      offeredPendingOnboardCount: 0,
      onboardedCount: 1,
      priority: "P0（紧急/高）",
      recruitmentStatus: "招聘中",
      requestedDate: "2026-05-07",
      requester: "马姬@maji_jj321",
      resumeContact: "小馒@atw0758",
      serviceUnit: "SETV",
      sourceSheet: "万帧公司",
      workLocation: "台湾",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      controlCategory: "C类-正常招聘",
      expectedOnboardDate: "2026-06-01",
      gapCount: 1,
      headcount: 2,
      jobLevel: "P3",
      jobSeries: "直属",
      notes: "台湾本地驻场办公",
      offeredPendingOnboardCount: 0,
      onboardedCount: 1,
      priority: "P0（紧急/高）",
      recruitmentStatus: "招聘中",
      requestedDate: "2026-05-07",
      requester: "马姬@maji_jj321",
      resumeContact: "小馒@atw0758",
      serviceUnit: "SETV",
      sourceSheet: "万帧公司",
      workLocation: "台湾",
    });
  });

  it("rejects negative headcount values", () => {
    const result = jobDescriptionFormSchema.safeParse({
      ...baseJobDescription,
      headcount: -1,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["headcount"]);
  });

  it("rejects invalid date strings", () => {
    const result = jobDescriptionFormSchema.safeParse({
      ...baseJobDescription,
      requestedDate: "2026/05/07",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["requestedDate"]);
  });
});
