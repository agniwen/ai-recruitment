import { describe, expect, it } from "vitest";

import {
  canViewPipelineStageTab,
  shouldShowAiInterviewTab,
  tabForPipelineStage,
} from "./studio-person-detail-model";

describe("shouldShowAiInterviewTab", () => {
  it("shows the tab while the candidate is in the AI interview stage", () => {
    expect(
      shouldShowAiInterviewTab({
        hasAiInterviewRounds: false,
        jobDescriptionAiInterviewDisabled: false,
        pipelineStage: "ai_interview",
      }),
    ).toBe(true);
  });

  it("keeps the tab available after later stages only when AI rounds exist", () => {
    for (const pipelineStage of ["human_interview", "offer", "closed"]) {
      expect(
        shouldShowAiInterviewTab({
          hasAiInterviewRounds: false,
          jobDescriptionAiInterviewDisabled: false,
          pipelineStage,
        }),
      ).toBe(false);
      expect(
        shouldShowAiInterviewTab({
          hasAiInterviewRounds: true,
          jobDescriptionAiInterviewDisabled: false,
          pipelineStage,
        }),
      ).toBe(true);
    }
  });

  it("shows retained AI rounds after a workflow reset to screening", () => {
    expect(
      shouldShowAiInterviewTab({
        hasAiInterviewRounds: true,
        jobDescriptionAiInterviewDisabled: false,
        pipelineStage: "screening",
      }),
    ).toBe(true);
  });

  it("always hides the tab when the current job disables AI interviews", () => {
    expect(
      shouldShowAiInterviewTab({
        hasAiInterviewRounds: true,
        jobDescriptionAiInterviewDisabled: true,
        pipelineStage: "human_interview",
      }),
    ).toBe(false);
  });
});

describe("canViewPipelineStageTab", () => {
  const base = {
    canReadHumanInterview: true,
    canReadOffer: true,
    hasAiInterviewRounds: true,
    jobDescriptionAiInterviewDisabled: false,
  };

  it("always allows overview-mapped stages", () => {
    expect(canViewPipelineStageTab("screening", base)).toBe(true);
    expect(canViewPipelineStageTab("closed", base)).toBe(true);
    expect(tabForPipelineStage("screening")).toBe("overview");
  });

  it("blocks human interview and offer tabs without read permission", () => {
    expect(
      canViewPipelineStageTab("human_interview", {
        ...base,
        canReadHumanInterview: false,
      }),
    ).toBe(false);
    expect(
      canViewPipelineStageTab("offer", {
        ...base,
        canReadOffer: false,
      }),
    ).toBe(false);
  });

  it("allows human interview and offer tabs when read permission is granted", () => {
    expect(canViewPipelineStageTab("human_interview", base)).toBe(true);
    expect(canViewPipelineStageTab("offer", base)).toBe(true);
  });

  it("blocks AI rounds tab when AI interviews are disabled on the job", () => {
    expect(
      canViewPipelineStageTab("ai_interview", {
        ...base,
        jobDescriptionAiInterviewDisabled: true,
      }),
    ).toBe(false);
  });
});
