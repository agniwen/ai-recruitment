import { describe, expect, it } from "vitest";

import { shouldShowAiInterviewTab } from "./studio-person-detail-model";

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
