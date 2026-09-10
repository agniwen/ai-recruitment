import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { resumeReviewLooseSchema } from "@arc/db-schema/resume-review";
import { formatResumeReviewMarkdown } from "@arc/shared/resume-review";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../mastra/agents/simple-generators", () => ({
  generateStructuredWithMastraAgent: mocks.generate,
  resumeReviewQualitativeAgent: { id: "resume-review-qualitative-agent" },
}));
// oxlint-disable-next-line import/first -- imports follow the hoisted generator mock.
import {
  buildResumeReviewPrompt,
  generateResumeReview,
  resumeReviewGenerationSchema,
  streamGenerateResumeReview,
  streamGenerateResumeReviewMarkdownFirst,
} from "../resume-analysis-review";
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

function modelOutput() {
  const dimension = {
    basis: "both",
    rationale: "React 项目交付对应岗位要求，具有工程实践证据。",
    score: 80,
  };
  return {
    conclusion: "核心经验匹配，建议核实职责后推进。",
    detailedOverall: {
      judgment: "具有相关经验。",
      matchingEvidence: "React 项目交付。",
      risks: "任职时间线待确认。",
    },
    dimensions: {
      educationBackground: dimension,
      experienceRelevance: dimension,
      potential: dimension,
      projectMatch: dimension,
      skillMatch: { ...dimension, score: 90 },
      stability: dimension,
    },
    levelRecommendation: null,
    nextStep: {
      action: "interview",
      disclaimer: "以上为初步结论",
      interviewFocus: ["请说明项目职责"],
      rationale: "具有相关项目经验。",
    },
    teamPositioning: null,
  };
}

describe("single-call numeric resume review", () => {
  beforeEach(() => {
    mocks.generate.mockReset();
    mocks.generate.mockResolvedValue(resumeReviewGenerationSchema.parse(modelOutput()));
  });

  it("generates version 5 with one call and computes the weighted score in code", async () => {
    const result = await generateResumeReview({
      jobDescription: "React 工程师",
      resumeProfile: PROFILE,
      resumeText: "原文事实",
    });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 8192,
        prompt: expect.stringContaining("原文事实"),
        strictJson: true,
      }),
    );
    expect(result.structuredReview).toMatchObject({
      dimensions: { skillMatch: { basis: "both", score: 90 } },
      overall: { baseScore: 84 },
      schemaVersion: 5,
      version: 5,
    });
    expect(resumeReviewLooseSchema.parse(result.structuredReview)).toEqual(result.structuredReview);
    expect(result.review).toContain("**判断**");
    expect(result.review).toContain("**匹配依据**");
    expect(result.review).toContain("**风险与待确认项**");
    expect(result.review).not.toContain("**偏差扫描**");
    expect(formatResumeReviewMarkdown(result.structuredReview)).toBe(result.review);
  });

  it("does not consume legacy screening rules or constrain the model action", async () => {
    const input = {
      jobDescription: "React 工程师",
      resumeProfile: PROFILE,
      screeningPolicy: {
        enabled: true,
        rules: [{ id: "blocked-rule", requirement: "legacy-only-rule" }],
        version: 1,
      },
      screeningResult: { policyEmpty: false, policyEnabled: true, recommendation: "hold" },
    };
    const result = await generateResumeReview(input);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(result.screeningResult).toBeNull();
    expect(result.structuredReview.nextStep.action).toBe("interview");
    expect(result.structuredReview.nextStep.rationale).toBe(modelOutput().nextStep.rationale);
    const [[{ prompt }]] = mocks.generate.mock.calls;
    expect(prompt).not.toContain("legacy-only-rule");
    expect(prompt).not.toContain("screeningEvidence");
    expect(prompt).not.toContain("已有筛选结果");
    expect(resumeReviewGenerationSchema.shape).not.toHaveProperty("screeningEvidence");
  });

  it("tolerates malformed optional guidance but rejects invalid core scores and missing judgment", () => {
    expect(
      resumeReviewGenerationSchema.parse({
        ...modelOutput(),
        levelRecommendation: 3,
        teamPositioning: {},
      }),
    ).toMatchObject({ levelRecommendation: null, teamPositioning: null });
    const invalid = modelOutput();
    invalid.dimensions.skillMatch.score = 101;
    expect(resumeReviewGenerationSchema.safeParse(invalid).success).toBe(false);
    expect(
      resumeReviewGenerationSchema.safeParse({ ...modelOutput(), detailedOverall: {} }).success,
    ).toBe(false);
    expect(resumeReviewGenerationSchema.safeParse(null).success).toBe(false);
  });

  it("uses job versus general standards and current China time without inventing negative evidence", () => {
    const prompt = buildResumeReviewPrompt(
      { resumeProfile: PROFILE },
      new Date("2026-09-09T17:00:00Z"),
    );
    expect(prompt).toContain("2026年9月10日");
    expect(prompt).toContain("未提供，使用通用职业标准");
    expect(prompt).toContain("0–39（不推荐）");
    expect(prompt).toContain("40–59（待定）");
    expect(prompt).toContain("60–89（推荐）");
    expect(prompt).toContain("90–100（非常推荐）");
    expect(prompt).toContain("信息不足使用 40–59");
    expect(prompt).not.toContain("85–100");
    expect(prompt).not.toContain("45–60");
    expect(prompt).toContain("不得根据毕业年份与总工龄推断空档");
    expect(prompt).toContain("basis=both");
  });

  it.each([streamGenerateResumeReview, streamGenerateResumeReviewMarkdownFirst])(
    "preserves stream artifacts with one call",
    async (stream) => {
      const text = await new Response(stream({ resumeProfile: PROFILE })).text();
      expect(mocks.generate).toHaveBeenCalledTimes(1);
      expect(text).toContain("resume.review.scoring");
      expect(text).toContain("resume.review.result");
      expect(text).toContain("run.completed");
      expect(text).toContain('"version":5');
    },
  );

  it("propagates provider failure and emits no successful stream result", async () => {
    mocks.generate.mockRejectedValue(new Error("model unavailable"));
    await expect(generateResumeReview({ resumeProfile: PROFILE })).rejects.toThrow(
      "model unavailable",
    );
    const text = await new Response(streamGenerateResumeReview({ resumeProfile: PROFILE })).text();
    expect(text).toContain("run.failed");
    expect(text).not.toContain("resume.review.result");
  });
});
