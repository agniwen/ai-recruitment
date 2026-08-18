import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";
import type { InstantRange } from "./date-range";

export const CURRENT_PENDING_EVALUATION_FACT = {
  outcome: "in_pipeline",
  pipelineStage: "screening",
  resumeEvaluationStatus: null,
} as const;

export function isCurrentPendingEvaluation(input: {
  outcome: CandidateOutcome;
  pipelineStage: PipelineStage;
  resumeEvaluationStatus: string | null;
}): boolean {
  return (
    input.outcome === CURRENT_PENDING_EVALUATION_FACT.outcome &&
    input.pipelineStage === CURRENT_PENDING_EVALUATION_FACT.pipelineStage &&
    input.resumeEvaluationStatus === CURRENT_PENDING_EVALUATION_FACT.resumeEvaluationStatus
  );
}

export function countUniqueAiCandidates(
  rows: { interviewRecordId: string; status: string }[],
): number {
  return new Set(
    rows.filter((row) => row.status !== "cancelled").map((row) => row.interviewRecordId),
  ).size;
}

export function countFirstSentOffers(
  rows: { interviewRecordId: string; sentAt: Date | null }[],
  range: InstantRange,
): number {
  const firstSentByInterview = new Map<string, Date>();
  for (const row of rows) {
    if (!row.sentAt) {
      continue;
    }
    const existing = firstSentByInterview.get(row.interviewRecordId);
    if (!existing || row.sentAt < existing) {
      firstSentByInterview.set(row.interviewRecordId, row.sentAt);
    }
  }
  return [...firstSentByInterview.values()].filter(
    (sentAt) => (!range.start || sentAt >= range.start) && (!range.end || sentAt < range.end),
  ).length;
}
