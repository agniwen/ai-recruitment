import { describe, expect, it } from "vitest";
import { offerDraftInputSchema } from "@arc/db-schema/studio-interviews";

const offer = { baseSalary: 12_000, position: "工程师" };

describe("Offer confirmation snapshot input", () => {
  it("preserves and normalizes the candidate private Telegram in the Offer snapshot", () => {
    const parsed = offerDraftInputSchema.parse({
      ...offer,
      confirmationInfo: { candidatePrivateTelegram: "  https://t.me/Candidate_123  " },
    });
    expect(parsed.confirmationInfo).toHaveProperty("candidatePrivateTelegram", "@Candidate_123");
  });

  it.each([
    "https://t.me/+private_invite",
    "https://t.me.evil.test/candidate_a",
    "https://t.me/candidate_a?start=token",
    "https://t.me/candidate_a/other",
    "candidate a",
    "",
  ])("rejects invalid candidate private Telegram input %s", (candidatePrivateTelegram) => {
    expect(
      offerDraftInputSchema.safeParse({
        ...offer,
        confirmationInfo: { candidatePrivateTelegram },
      }).success,
    ).toBe(false);
  });

  it("retains a normalized snapshot separately from Offer notes", () => {
    const parsed = offerDraftInputSchema.parse({
      ...offer,
      confirmationInfo: {
        candidateName: "  候选人  ",
        departmentName: "  ",
        probationSalary: 10_000,
      },
      notes: "内部备注",
    });
    expect(parsed).toHaveProperty(
      "confirmationInfo",
      expect.objectContaining({
        candidateCode: null,
        candidateName: "候选人",
        departmentName: null,
        interviewRoundId: null,
        probationSalary: 10_000,
      }),
    );
    expect(parsed.notes).toBe("内部备注");
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid probation salary %s",
    (probationSalary) => {
      expect(
        offerDraftInputSchema.safeParse({ ...offer, confirmationInfo: { probationSalary } })
          .success,
      ).toBe(false);
    },
  );

  it("rejects an oversized interview evaluation", () => {
    expect(
      offerDraftInputSchema.safeParse({
        ...offer,
        confirmationInfo: { interviewFeedback: "评".repeat(5001) },
      }).success,
    ).toBe(false);
  });

  it("keeps the snapshot optional for existing API clients and accepts explicit null", () => {
    expect(offerDraftInputSchema.parse(offer)).not.toHaveProperty("confirmationInfo");
    expect(offerDraftInputSchema.parse({ ...offer, confirmationInfo: null })).toHaveProperty(
      "confirmationInfo",
      null,
    );
  });
});
