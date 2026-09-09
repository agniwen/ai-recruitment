import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { structuredSchema } from "@arc/db-schema/resume-parser-schema";
import { parseJsonOutput } from "../json-output";
import { toResumeProfile } from "../resume-parser-agent";

describe("sparse resume extraction", () => {
  it("accepts the missing timeline fields reported by the compatible model", () => {
    const result = parseJsonOutput(
      JSON.stringify({
        name: "候选人",
        timelineSummary: { currentStatus: "在职", dateRanges: ["2021-至今"] },
      }),
      structuredSchema,
      "resume-test",
    );
    expect(result.timelineSummary).toEqual({
      currentStatus: "在职",
      dateRanges: ["2021-至今"],
      estimatedExperienceYears: null,
      riskSignals: [],
    });
    expect(result.age).toBeNull();
    expect(result.workYears).toBeNull();
    expect(result.email).toBeNull();
    expect(toResumeProfile(result).skills).toEqual([]);
  });

  it.each([undefined, null])(
    "normalizes missing or null collections and timeline (%s)",
    (value) => {
      const result = structuredSchema.parse({
        educationExperiences: value,
        links: value,
        personalStrengths: value,
        projectExperiences: value,
        schools: value,
        skills: value,
        targetRoles: value,
        timelineSummary: value,
        workExperiences: value,
      });
      expect(result).toEqual(structuredSchema.parse({}));
      expect(result.timelineSummary).toEqual({
        currentStatus: null,
        dateRanges: [],
        estimatedExperienceYears: null,
        riskSignals: [],
      });
    },
  );

  it("keeps partial experience entries and normalizes nested missing information", () => {
    const result = structuredSchema.parse({
      educationExperiences: [{ school: "某大学" }],
      projectExperiences: [{ name: "招聘系统", techStack: null }, { techStack: ["React"] }],
      timelineSummary: { dateRanges: null, riskSignals: null },
      workExperiences: [{ company: "某公司" }],
    });
    expect(result.educationExperiences[0]).toMatchObject({ degree: null, school: "某大学" });
    expect(result.projectExperiences[0]).toMatchObject({ role: null, techStack: [] });
    expect(result.workExperiences[0]).toEqual({
      company: "某公司",
      period: null,
      role: null,
      summary: null,
    });
    expect(toResumeProfile(result).skills).toEqual(["React"]);
  });

  it.each([null, "not a resume", []].map((value) => [value]))(
    "still rejects invalid types instead of silently discarding supplied data (%j)",
    (value) => {
      expect(structuredSchema.safeParse(value).success).toBe(false);
    },
  );

  it("normalizes model type variations without losing usable resume fields", () => {
    const result = parseJsonOutput(
      JSON.stringify({
        age: "28",
        educationExperiences: false,
        graduationYear: 2020,
        name: "候选人",
        phone: 13_800_138_000,
        projectExperiences: [null, "invalid", { name: "招聘系统", techStack: "React" }],
        skills: ["React", null, { invalid: true }, "TypeScript"],
        targetRoles: "前端工程师",
        timelineSummary: { dateRanges: "2022-至今", estimatedExperienceYears: "3.5" },
        workExperiences: { company: "某公司", summary: { invalid: true } },
        workYears: "unknown",
      }),
      structuredSchema,
      "resume-test",
    );
    expect(result).toMatchObject({
      age: 28,
      educationExperiences: [],
      graduationYear: "2020",
      name: "候选人",
      phone: "13800138000",
      skills: ["React", "TypeScript"],
      targetRoles: ["前端工程师"],
      timelineSummary: { dateRanges: ["2022-至今"], estimatedExperienceYears: 3.5 },
      workYears: null,
    });
    expect(result.workExperiences).toEqual([
      { company: "某公司", period: null, role: null, summary: null },
    ]);
    expect(result.projectExperiences).toHaveLength(1);
    expect(result.projectExperiences[0]).toMatchObject({ name: "招聘系统", techStack: ["React"] });
    expect(toResumeProfile(result).skills).toEqual(["React", "TypeScript"]);
  });

  it.each(["", "  ", false, [], {}, "3-5年", "Infinity"].map((value) => [value]))(
    "does not invent numeric facts from ambiguous values (%j)",
    (value) => {
      expect(structuredSchema.parse({ age: value, workYears: value }).age).toBeNull();
      expect(structuredSchema.parse({ age: value, workYears: value }).workYears).toBeNull();
    },
  );

  it.each([false, "unknown", []].map((value) => [value]))(
    "tolerates an unusable timeline (%j)",
    (value) => {
      expect(structuredSchema.parse({ timelineSummary: value }).timelineSummary).toEqual(
        structuredSchema.parse({}).timelineSummary,
      );
    },
  );

  it("remains convertible to the JSON schema used by structured-output models", () => {
    const schema = z.toJSONSchema(structuredSchema);
    expect(schema.type).toBe("object");
    expect(schema.properties?.skills).toMatchObject({ type: "array" });
    expect(schema.properties?.timelineSummary).toMatchObject({ type: "object" });
  });
});

describe("downstream profile validation", () => {
  it.each([
    undefined,
    null,
    {},
    { educationExperiences: null, projectExperiences: [null, {}], workExperiences: null },
  ])("accepts absent objects before later workflows (%j)", (value) => {
    const profile = resumeProfileSchema.parse(value);
    expect(profile.name).toBe("未发现信息");
    expect(profile.skills).toEqual([]);
    expect(profile.workExperiences).toEqual([]);
    expect(profile.projectExperiences.every((project) => Array.isArray(project.techStack))).toBe(
      true,
    );
  });
});
