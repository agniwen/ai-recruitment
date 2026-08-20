import { describe, expect, it } from "vitest";
import {
  countFirstSentOffers,
  countUniqueAiCandidates,
  isCurrentPendingEvaluation,
  latestOfferByInterview,
} from "./metric-policies";

describe("ODC analysis confirmed metric policies", () => {
  it("only treats unevaluated screening candidates as currently pending", () => {
    expect(
      isCurrentPendingEvaluation({
        outcome: "in_pipeline",
        pipelineStage: "screening",
        resumeEvaluationStatus: null,
      }),
    ).toBe(true);
    expect(
      isCurrentPendingEvaluation({
        outcome: "in_pipeline",
        pipelineStage: "screening",
        resumeEvaluationStatus: "pass",
      }),
    ).toBe(false);
    expect(
      isCurrentPendingEvaluation({
        outcome: "in_pipeline",
        pipelineStage: "ai_interview",
        resumeEvaluationStatus: null,
      }),
    ).toBe(false);
  });

  it("counts AI interviews by unique candidate and excludes cancellations", () => {
    expect(
      countUniqueAiCandidates([
        { interviewRecordId: "candidate-1", status: "pending" },
        { interviewRecordId: "candidate-1", status: "completed" },
        { interviewRecordId: "candidate-2", status: "cancelled" },
        { interviewRecordId: "candidate-3", status: "in_progress" },
      ]),
    ).toBe(2);
  });

  it("counts an Offer only when its first successful send is in range", () => {
    const range = {
      end: new Date("2026-08-19T00:00:00.000Z"),
      start: new Date("2026-08-18T00:00:00.000Z"),
    };
    expect(
      countFirstSentOffers(
        [
          {
            interviewRecordId: "candidate-1",
            sentAt: new Date("2026-08-17T12:00:00.000Z"),
          },
          {
            interviewRecordId: "candidate-1",
            sentAt: new Date("2026-08-18T12:00:00.000Z"),
          },
          {
            interviewRecordId: "candidate-2",
            sentAt: new Date("2026-08-18T08:00:00.000Z"),
          },
          { interviewRecordId: "candidate-3", sentAt: null },
        ],
        range,
      ),
    ).toBe(1);
  });

  it("attributes an Offer to the role that made its first successful send", () => {
    const range = {
      end: new Date("2026-08-19T00:00:00.000Z"),
      start: new Date("2026-08-18T00:00:00.000Z"),
    };
    const rows = [
      {
        interviewRecordId: "candidate-1",
        role: "hr",
        sentAt: new Date("2026-08-18T08:00:00.000Z"),
      },
      {
        interviewRecordId: "candidate-1",
        role: "odc",
        sentAt: new Date("2026-08-18T12:00:00.000Z"),
      },
      {
        interviewRecordId: "candidate-2",
        role: "odc",
        sentAt: new Date("2026-08-18T09:00:00.000Z"),
      },
    ];

    expect(countFirstSentOffers(rows, range, "odc")).toBe(1);
    expect(countFirstSentOffers(rows, range, "hr")).toBe(1);
  });

  it("attributes the effective Offer to the role on its latest active version", () => {
    const latest = latestOfferByInterview([
      { interviewRecordId: "candidate-1", role: "hr", version: 1 },
      { interviewRecordId: "candidate-1", role: "odc", version: 2 },
    ]);

    expect(latest.get("candidate-1")?.role).toBe("odc");
  });
});
