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

  it.each([null, "not a resume", { age: "unknown" }, { skills: "React" }])(
    "still rejects invalid types instead of silently discarding supplied data (%j)",
    (value) => {
      expect(structuredSchema.safeParse(value).success).toBe(false);
    },
  );

  it("remains convertible to the JSON schema used by structured-output models", () => {
    const schema = z.toJSONSchema(structuredSchema);
    expect(schema.type).toBe("object");
    expect(schema.properties?.skills).toMatchObject({ type: "array" });
    expect(schema.properties?.timelineSummary).toMatchObject({ type: "object" });
  });
});
