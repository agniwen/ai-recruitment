import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";
import type { InstantRange } from "./date-range";
import { matchesSelectedRole } from "./utils/role-filter";

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

export function latestOfferByInterview<T extends { interviewRecordId: string; version: number }>(
  rows: T[],
): Map<string, T> {
  const latestOffers = new Map<string, T>();
  for (const offer of rows) {
    const latest = latestOffers.get(offer.interviewRecordId);
    if (!latest || offer.version > latest.version) {
      latestOffers.set(offer.interviewRecordId, offer);
    }
  }
  return latestOffers;
}

export function countFirstSentOffers(
  rows: { interviewRecordId: string; role?: string | null; sentAt: Date | null }[],
  range: InstantRange,
  selectedRole?: string,
): number {
  const firstSentByInterview = new Map<string, { role: string | null | undefined; sentAt: Date }>();
  for (const row of rows) {
    if (!row.sentAt) {
      continue;
    }
    const existing = firstSentByInterview.get(row.interviewRecordId);
    if (!existing || row.sentAt < existing.sentAt) {
      firstSentByInterview.set(row.interviewRecordId, { role: row.role, sentAt: row.sentAt });
    }
  }
  return [...firstSentByInterview.values()].filter(
    ({ role, sentAt }) =>
      matchesSelectedRole(role, selectedRole) &&
      (!range.start || sentAt >= range.start) &&
      (!range.end || sentAt < range.end),
  ).length;
}
