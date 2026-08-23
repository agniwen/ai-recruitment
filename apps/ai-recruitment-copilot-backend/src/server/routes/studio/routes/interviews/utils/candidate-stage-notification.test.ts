import { describe, expect, it } from "vitest";
import { buildCandidateStageNotification } from "./candidate-stage-notification";

describe("buildCandidateStageNotification", () => {
  it("describes an active candidate stage transition", () => {
    expect(
      buildCandidateStageNotification({
        candidateName: "张三",
        fromOutcome: "in_pipeline",
        fromStage: "screening",
        jobDescriptionName: "后端工程师",
        toOutcome: "in_pipeline",
        toStage: "ai_interview",
      }),
    ).toBe(
      [
        "候选人状态更新",
        "候选人：张三",
        "关联岗位：后端工程师",
        "招聘阶段：简历筛选 → AI 面试",
        "候选人状态：进行中",
      ].join("\n"),
    );
  });

  it("includes the changed terminal outcome", () => {
    expect(
      buildCandidateStageNotification({
        candidateName: "李四",
        fromOutcome: "in_pipeline",
        fromStage: "offer",
        jobDescriptionName: null,
        toOutcome: "hired",
        toStage: "closed",
      }),
    ).toContain("候选人状态：进行中 → 已到岗");
  });
});
