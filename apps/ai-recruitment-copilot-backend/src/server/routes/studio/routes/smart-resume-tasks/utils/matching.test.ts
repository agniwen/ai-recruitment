import { describe, expect, it } from "vitest";
import { buildResumeMatchingText, checkJobRequirements, rankJobEvidence } from "./matching";
import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import type { JobMatchingProfile } from "@arc/db-schema/job-matching";

const job: JobMatchingProfile = {
  domains: [],
  minimumEducation: "本科",
  minimumWorkYears: 5,
  preferredSkills: [],
  requiredSkills: ["React"],
  responsibilities: ["开发前端应用"],
  roleFamily: "前端开发",
  seniority: "高级",
};
const resume = resumeProfileSchema.parse({
  age: 30,
  educationExperiences: [],
  email: "secret@example.com",
  gender: "未发现信息",
  name: "测试姓名",
  personalStrengths: [],
  phone: "13800138000",
  projectExperiences: [],
  schools: [],
  skills: ["React"],
  targetRoles: [],
  workExperiences: [
    {
      company: "某公司",
      period: "2022-2025",
      role: "前端工程师",
      summary: "使用 React 开发管理系统",
    },
  ],
  workYears: 3,
});

describe("smart resume matching facts", () => {
  it("matches demonstrated work when target roles are absent, without contact details", () => {
    const text = buildResumeMatchingText(resume);
    expect(text).toContain("使用 React 开发管理系统");
    expect(text).not.toContain("测试姓名");
    expect(text).not.toContain("13800138000");
    expect(text).not.toContain("secret@example.com");
  });
  it("does not turn inferred requirements or absent education into a hard rejection", () => {
    expect(checkJobRequirements(resume, job, false).blocked).toBe(false);
    const checked = checkJobRequirements(resume, job, true);
    expect(checked.blocked).toBe(true);
    expect(checked.warnings).toContain("学历信息待确认");
  });
  it("quotes existing fields instead of generating evidence", () => {
    const facts = rankJobEvidence(resume, job);
    expect(facts.matchedSkills).toEqual(["React"]);
    expect(facts.evidence).toContainEqual({
      field: "workExperiences.0.summary",
      quote: "使用 React 开发管理系统",
    });
  });
});
