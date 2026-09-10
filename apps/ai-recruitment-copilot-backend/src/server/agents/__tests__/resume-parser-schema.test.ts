import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isResumeStructuredSourceFileNameCompatible,
  structuredSchema,
} from "@arc/db-schema/resume-parser-schema";
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

describe("resume scoring facts compatibility", () => {
  it("preserves valid facts while normalizing malformed siblings", () => {
    const structured = structuredSchema.parse({
      name: "候选人",
      scoringFacts: {
        employmentEpisodes: [
          null,
          {
            currentStatus: "invalid",
            endMonth: "2024-99",
            evidence: ["2022年1月加入示例公司", null],
            primaryStatus: null,
            sourceIndex: "0",
            startMonth: "2022-01",
          },
        ],
        projects: false,
        skillFacts: [
          { evidence: "使用 React 开发", evidenceLevel: "applied", normalizedSkill: "React" },
          null,
        ],
        version: 1,
      },
      skills: ["React"],
      workExperiences: [{ company: "示例公司" }],
    });
    expect(structured.scoringFacts).toMatchObject({
      employmentEpisodes: [
        {
          currentStatus: "unknown",
          endMonth: null,
          evidence: ["2022年1月加入示例公司"],
          primaryStatus: "unresolved",
          sourceIndex: 0,
          startMonth: "2022-01",
        },
      ],
      projects: [],
      skillFacts: [
        { evidence: ["使用 React 开发"], evidenceLevel: "applied", normalizedSkill: "React" },
      ],
      version: 1,
    });
    expect(toResumeProfile(structured).scoringFacts).toMatchObject({
      employmentEpisodes: [{ sourceIndex: 0, startMonth: "2022-01" }],
      skillFacts: [{ evidence: ["使用 React 开发"], normalizedSkill: "React" }],
    });
    expect(resumeProfileSchema.parse(toResumeProfile(structured)).scoringFacts).toEqual(
      toResumeProfile(structured).scoringFacts,
    );
  });

  it.each([undefined, null, false, "invalid", {}, { version: 2 }])(
    "keeps core fields when scoring facts are unusable (%j)",
    (scoringFacts) => {
      const result = toResumeProfile({ name: "候选人", scoringFacts, workYears: "3.5" });
      expect(result).toMatchObject({ name: "候选人", workYears: 3.5 });
      expect(result.scoringFacts).toEqual({
        additionalEvidence: [],
        employmentEpisodes: [],
        projects: [],
        skillFacts: [],
        version: 1,
      });
    },
  );

  it("does not assign out-of-range evidence to a different experience", () => {
    const result = toResumeProfile({
      name: "候选人",
      scoringFacts: {
        employmentEpisodes: [{ evidence: ["其他公司"], sourceIndex: 8, startMonth: "2000-01" }],
      },
      workExperiences: [{ company: "公司" }],
    });
    expect(result.scoringFacts?.employmentEpisodes).toEqual([
      {
        currentStatus: "unknown",
        endMonth: null,
        evidence: [],
        gapExplanation: null,
        primaryStatus: "unresolved",
        sourceIndex: 0,
        startMonth: null,
      },
    ]);
  });
});

it("remaps scoring evidence when malformed experience rows are removed", () => {
  const result = toResumeProfile({
    scoringFacts: {
      employmentEpisodes: [
        { evidence: ["无效公司"], sourceIndex: 0 },
        { evidence: ["正确公司经历"], sourceIndex: 1, startMonth: "2022-01" },
      ],
    },
    workExperiences: [null, { company: "正确公司" }],
  });
  expect(result.scoringFacts?.employmentEpisodes).toMatchObject([
    { evidence: ["正确公司经历"], sourceIndex: 0, startMonth: "2022-01" },
  ]);
});

it("only reuses filename-sensitive cache for the same source filename", () => {
  expect(
    isResumeStructuredSourceFileNameCompatible(
      { name: "张三", sourceFileName: "张三.pdf" },
      "张三.pdf",
    ),
  ).toBe(true);
  expect(
    isResumeStructuredSourceFileNameCompatible(
      { name: "张三", sourceFileName: "张三.pdf" },
      "李四.pdf",
    ),
  ).toBe(false);
  expect(isResumeStructuredSourceFileNameCompatible({ name: "张三" }, "张三.pdf")).toBe(false);
});

it("keeps evidence for skills collected from project tech stacks", () => {
  const result = toResumeProfile({
    projectExperiences: [{ name: "系统", techStack: ["React"] }],
    scoringFacts: {
      skillFacts: [
        { evidence: ["使用 React 开发系统"], evidenceLevel: "applied", normalizedSkill: "React" },
      ],
    },
    skills: [],
  });
  expect(result.skills).toEqual(["React"]);
  expect(result.scoringFacts?.skillFacts).toEqual([
    { evidence: ["使用 React 开发系统"], evidenceLevel: "applied", normalizedSkill: "React" },
  ]);
});
