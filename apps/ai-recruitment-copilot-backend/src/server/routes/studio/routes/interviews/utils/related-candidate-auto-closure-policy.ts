import type { StudioInterviewResumeSourceType } from "@arc/db-schema/schema";
import { candidateOutcomeMeta, pipelineStageMeta } from "@arc/db-schema/studio-interviews";
import type { CandidateOutcome, ClosedMeta, PipelineStage } from "@arc/db-schema/studio-interviews";
import { resolveCandidateTransitionPatch } from "./candidate-transition";

export const AUTO_CLOSE_RESUME_SIMILARITY_THRESHOLD = 90;

export type RelatedCandidateMatch =
  | { kind: "resume_pool_source" }
  | { kind: "semantic_similarity"; similarityScore: number };

export interface AutomaticCandidateClosureAuditDetail {
  automaticClosure: true;
  fromOutcome: CandidateOutcome;
  fromStage: PipelineStage;
  matchKind: RelatedCandidateMatch["kind"];
  reason: string;
  similarityScore: number | null;
  toOutcome: "archived";
  toStage: "closed";
  triggerCandidateId: string;
  triggerCandidateName: string;
}

export interface SemanticDuplicateRow {
  matchedSourceId: string;
  score: number;
  sourceId: string;
}

function isCandidateOutcome(value: unknown): value is CandidateOutcome {
  return typeof value === "string" && Object.hasOwn(candidateOutcomeMeta, value);
}

function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && Object.hasOwn(pipelineStageMeta, value);
}

export function isDirectUploadCandidate(input: {
  poolItemId: string | null;
  sourceType: StudioInterviewResumeSourceType | null;
}): boolean {
  return (
    input.poolItemId === null && (input.sourceType === null || input.sourceType === "direct_upload")
  );
}

export function collectSemanticDuplicateCandidates(
  hiredCandidateId: string,
  rows: readonly SemanticDuplicateRow[],
): { candidateId: string; similarityScore: number }[] {
  const scoresByCandidateId = new Map<string, number>();
  for (const row of rows) {
    if (row.score < AUTO_CLOSE_RESUME_SIMILARITY_THRESHOLD) {
      continue;
    }
    const candidateId = row.sourceId === hiredCandidateId ? row.matchedSourceId : row.sourceId;
    if (candidateId === hiredCandidateId) {
      continue;
    }
    scoresByCandidateId.set(
      candidateId,
      Math.max(scoresByCandidateId.get(candidateId) ?? 0, row.score),
    );
  }
  return [...scoresByCandidateId]
    .map(([candidateId, similarityScore]) => ({ candidateId, similarityScore }))
    .toSorted((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function automaticClosureReason(hiredCandidateName: string, match: RelatedCandidateMatch): string {
  if (match.kind === "resume_pool_source") {
    return `同一简历池记录派生的候选人「${hiredCandidateName}」已录用，系统自动结束流程。`;
  }
  return `高相似简历候选人「${hiredCandidateName}」已录用（相似度 ${match.similarityScore}%），系统自动结束流程。`;
}

export function automaticClosureMatchLabel(
  matchKind: AutomaticCandidateClosureAuditDetail["matchKind"],
): string {
  const labels = {
    resume_pool_source: "同一简历池来源",
    semantic_similarity: "简历相似度",
  } satisfies Record<AutomaticCandidateClosureAuditDetail["matchKind"], string>;
  return labels[matchKind];
}

export function readAutomaticCandidateClosureAuditDetail(
  detail: Record<string, unknown>,
): AutomaticCandidateClosureAuditDetail | null {
  const { fromOutcome, fromStage, matchKind } = detail;
  if (
    detail.automaticClosure !== true ||
    !isCandidateOutcome(fromOutcome) ||
    !isPipelineStage(fromStage) ||
    (matchKind !== "resume_pool_source" && matchKind !== "semantic_similarity") ||
    typeof detail.reason !== "string" ||
    detail.toOutcome !== "archived" ||
    detail.toStage !== "closed" ||
    typeof detail.triggerCandidateId !== "string" ||
    typeof detail.triggerCandidateName !== "string"
  ) {
    return null;
  }
  let similarityScore: number | null = null;
  if (matchKind === "semantic_similarity") {
    if (typeof detail.similarityScore !== "number") {
      return null;
    }
    ({ similarityScore } = detail);
  } else if (detail.similarityScore !== null) {
    return null;
  }
  return {
    automaticClosure: true,
    fromOutcome,
    fromStage,
    matchKind,
    reason: detail.reason,
    similarityScore,
    toOutcome: "archived",
    toStage: "closed",
    triggerCandidateId: detail.triggerCandidateId,
    triggerCandidateName: detail.triggerCandidateName,
  };
}

export function buildAutomaticCandidateClosure(input: {
  candidate: {
    closedMeta: ClosedMeta | null;
    id: string;
    name: string;
    outcome: CandidateOutcome;
    pipelineStage: PipelineStage;
  };
  match: RelatedCandidateMatch;
  now: Date;
  hiredCandidate: { id: string; name: string };
}) {
  const reason = automaticClosureReason(input.hiredCandidate.name, input.match);
  const transition = resolveCandidateTransitionPatch({
    existing: input.candidate,
    input: {
      closedMeta: { category: "other", internalNotes: reason },
      closedReason: reason,
      outcome: "archived",
      pipelineStage: "closed",
    },
    now: input.now,
  });
  return {
    auditDetail: {
      ...transition.auditDetail,
      automaticClosure: true,
      matchKind: input.match.kind,
      reason,
      similarityScore:
        input.match.kind === "semantic_similarity" ? input.match.similarityScore : null,
      toOutcome: "archived",
      toStage: "closed",
      triggerCandidateId: input.hiredCandidate.id,
      triggerCandidateName: input.hiredCandidate.name,
    } satisfies AutomaticCandidateClosureAuditDetail,
    patch: transition.patch,
  };
}
