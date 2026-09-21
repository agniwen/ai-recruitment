import { describe, expect, it } from "vitest";
import {
  HUMAN_INTERVIEW_FEEDBACK_REQUIRED_MESSAGE,
  HUMAN_INTERVIEW_FAILED_FOR_OFFER_MESSAGE,
  HUMAN_INTERVIEW_INCONCLUSIVE_FOR_OFFER_MESSAGE,
  getHumanInterviewOfferReadinessError,
  humanInterviewFeedbackSchema,
} from "./human-interview-readiness";

describe("humanInterviewFeedbackSchema", () => {
  it("rejects missing and blank feedback", () => {
    const missingFeedback: unknown = undefined;
    expect(humanInterviewFeedbackSchema.safeParse(missingFeedback).success).toBe(false);
    const blank = humanInterviewFeedbackSchema.safeParse("   ");
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe(HUMAN_INTERVIEW_FEEDBACK_REQUIRED_MESSAGE);
  });

  it("normalizes meaningful feedback", () => {
    expect(humanInterviewFeedbackSchema.parse("  沟通清晰，经验匹配  ")).toBe("沟通清晰，经验匹配");
  });
});

describe("getHumanInterviewOfferReadinessError", () => {
  it.each([
    {
      completedRoundsMissingFeedback: 0,
      failedRounds: 0,
      inconclusiveRounds: 0,
      pendingRounds: 0,
      totalRounds: 0,
    },
    {
      completedRoundsMissingFeedback: 0,
      failedRounds: 0,
      inconclusiveRounds: 0,
      pendingRounds: 1,
      totalRounds: 2,
    },
    {
      completedRoundsMissingFeedback: 1,
      failedRounds: 0,
      inconclusiveRounds: 0,
      pendingRounds: 0,
      totalRounds: 2,
    },
  ])("blocks an offer when readiness is %o", (readiness) => {
    expect(getHumanInterviewOfferReadinessError(readiness)).not.toBeNull();
  });

  it("allows an offer after every round is completed with feedback", () => {
    expect(
      getHumanInterviewOfferReadinessError({
        completedRoundsMissingFeedback: 0,
        failedRounds: 0,
        inconclusiveRounds: 0,
        pendingRounds: 0,
        totalRounds: 2,
      }),
    ).toBeNull();
  });

  it("blocks an offer after a failed round", () => {
    expect(
      getHumanInterviewOfferReadinessError({
        completedRoundsMissingFeedback: 0,
        failedRounds: 1,
        inconclusiveRounds: 0,
        pendingRounds: 0,
        totalRounds: 1,
      }),
    ).toBe(HUMAN_INTERVIEW_FAILED_FOR_OFFER_MESSAGE);
  });

  it("blocks an offer after an inconclusive round", () => {
    expect(
      getHumanInterviewOfferReadinessError({
        completedRoundsMissingFeedback: 0,
        failedRounds: 0,
        inconclusiveRounds: 1,
        pendingRounds: 0,
        totalRounds: 1,
      }),
    ).toBe(HUMAN_INTERVIEW_INCONCLUSIVE_FOR_OFFER_MESSAGE);
  });
});
