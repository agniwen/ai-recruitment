import { describe, expect, it, vi } from "vitest";
import { createJobMatchingExtractionSchema, validateProfileSources } from "./matching-profile";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

const profile = {
  domains: [],
  minimumEducation: null,
  minimumWorkYears: null,
  preferredSkills: [],
  requiredSkills: ["React"],
  responsibilities: [],
  roleFamily: "前端开发",
  seniority: "",
};

describe("job profile source validation", () => {
  it("ignores whitespace formatting while rejecting changed words or punctuation", () => {
    const schema = createJobMatchingExtractionSchema("前端开发，要求\n React");
    const output = {
      profile,
      sources: [
        { field: "requiredSkills", quote: "要求 React" },
        { field: "roleFamily", quote: "前端开发" },
      ],
    };
    expect(schema.safeParse(output).success).toBe(true);
    expect(
      schema.safeParse({
        ...output,
        sources: [{ field: "requiredSkills", quote: " " }, output.sources[1]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...output,
        sources: [{ field: "requiredSkills", quote: "要求：React" }, output.sources[1]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...output,
        sources: [{ field: "requiredSkills", quote: "要求 React 专家" }, output.sources[1]],
      }).success,
    ).toBe(false);
  });
  it("validates source quotes inside the generation schema so invalid evidence can be retried", () => {
    const schema = createJobMatchingExtractionSchema("前端开发，要求 React");
    expect(
      schema.safeParse({
        profile,
        sources: [
          { field: "requiredSkills", quote: "React" },
          { field: "roleFamily", quote: "前端开发" },
        ],
      }).success,
    ).toBe(true);
    const invalid = schema.safeParse({
      profile,
      sources: [
        { field: "requiredSkills", quote: "React 专家" },
        { field: "roleFamily", quote: "前端开发" },
      ],
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0]?.message).toContain("引用不在原文");
    }
  });
  it("requires verbatim source evidence for every populated field", () => {
    expect(
      validateProfileSources(
        {
          profile,
          sources: [
            { field: "requiredSkills", quote: "React" },
            { field: "roleFamily", quote: "前端开发" },
          ],
        },
        "前端开发，要求 React",
      ),
    ).toEqual(profile);
    expect(() =>
      validateProfileSources(
        { profile, sources: [{ field: "requiredSkills", quote: "React" }] },
        "要求 React",
      ),
    ).toThrow("缺少原文依据");
    expect(() =>
      validateProfileSources(
        { profile, sources: [{ field: "roleFamily", quote: "LLM编造的引文" }] },
        "前端开发",
      ),
    ).toThrow("引用不在原文");
  });
});
