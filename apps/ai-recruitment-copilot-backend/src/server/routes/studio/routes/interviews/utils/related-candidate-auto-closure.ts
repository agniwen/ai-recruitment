import { and, eq, gte, inArray, ne, or } from "drizzle-orm";
import type { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog, resumeDuplicateMatch, studioInterview } from "@arc/db-schema/schema";
import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";
import { getResumeSemanticIndexConfig } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer";
import {
  AUTO_CLOSE_RESUME_SIMILARITY_THRESHOLD,
  buildAutomaticCandidateClosure,
  collectSemanticDuplicateCandidates,
  isDirectUploadCandidate,
} from "./related-candidate-auto-closure-policy";
import type { RelatedCandidateMatch } from "./related-candidate-auto-closure-policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface AutomaticClosureCandidate {
  closedMeta: typeof studioInterview.$inferSelect.closedMeta;
  id: string;
  name: string;
  outcome: CandidateOutcome;
  pipelineStage: PipelineStage;
}

export interface AutomaticallyClosedCandidate {
  candidateId: string;
  candidateName: string;
  fromOutcome: CandidateOutcome;
  fromStage: PipelineStage;
  match: RelatedCandidateMatch;
}

const candidateSelection = {
  closedMeta: studioInterview.closedMeta,
  id: studioInterview.id,
  name: studioInterview.candidateName,
  outcome: studioInterview.outcome,
  pipelineStage: studioInterview.pipelineStage,
};

async function loadPoolRelatedCandidates(
  tx: Tx,
  input: { hiredCandidateId: string; organizationId: string; poolItemId: string },
): Promise<{ candidate: AutomaticClosureCandidate; match: RelatedCandidateMatch }[]> {
  const candidates = await tx
    .select(candidateSelection)
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.organizationId, input.organizationId),
        eq(studioInterview.resumeSourcePoolItemId, input.poolItemId),
        ne(studioInterview.id, input.hiredCandidateId),
        eq(studioInterview.outcome, "in_pipeline"),
      ),
    )
    .orderBy(studioInterview.id)
    .for("update", { of: studioInterview });
  return candidates.map((candidate) => ({
    candidate,
    match: { kind: "resume_pool_source" },
  }));
}

async function loadStoredSemanticMatches(
  tx: Tx,
  input: { hiredCandidateId: string; organizationId: string },
) {
  const { embeddingVersion } = getResumeSemanticIndexConfig();
  const duplicateRows = await tx
    .select({
      matchedSourceId: resumeDuplicateMatch.matchedSourceId,
      score: resumeDuplicateMatch.score,
      sourceId: resumeDuplicateMatch.sourceId,
    })
    .from(resumeDuplicateMatch)
    .where(
      and(
        eq(resumeDuplicateMatch.organizationId, input.organizationId),
        eq(resumeDuplicateMatch.embeddingVersion, embeddingVersion),
        inArray(resumeDuplicateMatch.status, ["active", "confirmed"]),
        gte(resumeDuplicateMatch.score, AUTO_CLOSE_RESUME_SIMILARITY_THRESHOLD),
        or(
          and(
            eq(resumeDuplicateMatch.sourceType, "studio_interview"),
            eq(resumeDuplicateMatch.sourceId, input.hiredCandidateId),
            eq(resumeDuplicateMatch.matchedSourceType, "studio_interview"),
          ),
          and(
            eq(resumeDuplicateMatch.matchedSourceType, "studio_interview"),
            eq(resumeDuplicateMatch.matchedSourceId, input.hiredCandidateId),
            eq(resumeDuplicateMatch.sourceType, "studio_interview"),
          ),
        ),
      ),
    );
  return collectSemanticDuplicateCandidates(input.hiredCandidateId, duplicateRows);
}

async function loadSemanticRelatedCandidates(
  tx: Tx,
  input: {
    hiredCandidateId: string;
    organizationId: string;
    refreshedMatches?: { candidateId: string; similarityScore: number }[];
  },
): Promise<{ candidate: AutomaticClosureCandidate; match: RelatedCandidateMatch }[]> {
  const matches = input.refreshedMatches ?? (await loadStoredSemanticMatches(tx, input));
  if (matches.length === 0) {
    return [];
  }
  const matchByCandidateId = new Map(matches.map((match) => [match.candidateId, match]));
  const candidates = await tx
    .select(candidateSelection)
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.organizationId, input.organizationId),
        inArray(
          studioInterview.id,
          matches.map((match) => match.candidateId),
        ),
        eq(studioInterview.outcome, "in_pipeline"),
      ),
    )
    .orderBy(studioInterview.id)
    .for("update", { of: studioInterview });
  return candidates.flatMap((candidate) => {
    const match = matchByCandidateId.get(candidate.id);
    return match
      ? [
          {
            candidate,
            match: {
              kind: "semantic_similarity" as const,
              similarityScore: match.similarityScore,
            },
          },
        ]
      : [];
  });
}

export async function autoCloseRelatedCandidatesAfterHire(input: {
  now: Date;
  operatorId: string | null;
  operatorRole?: string | null;
  organizationId: string;
  refreshedSemanticMatches?: { candidateId: string; similarityScore: number }[];
  tx: Tx;
  hiredCandidate: {
    id: string;
    name: string;
    poolItemId: string | null;
    sourceType: typeof studioInterview.$inferSelect.resumeSourceType;
  };
}): Promise<AutomaticallyClosedCandidate[]> {
  let related: { candidate: AutomaticClosureCandidate; match: RelatedCandidateMatch }[] = [];
  if (input.hiredCandidate.poolItemId) {
    related = await loadPoolRelatedCandidates(input.tx, {
      hiredCandidateId: input.hiredCandidate.id,
      organizationId: input.organizationId,
      poolItemId: input.hiredCandidate.poolItemId,
    });
  } else if (
    isDirectUploadCandidate({
      poolItemId: input.hiredCandidate.poolItemId,
      sourceType: input.hiredCandidate.sourceType,
    })
  ) {
    related = await loadSemanticRelatedCandidates(input.tx, {
      hiredCandidateId: input.hiredCandidate.id,
      organizationId: input.organizationId,
      refreshedMatches: input.refreshedSemanticMatches,
    });
  }
  if (related.length === 0) {
    return [];
  }

  const closed: AutomaticallyClosedCandidate[] = [];
  const auditRows: (typeof interviewAuditLog.$inferInsert)[] = [];
  for (const { candidate, match } of related) {
    const closure = buildAutomaticCandidateClosure({
      candidate,
      hiredCandidate: input.hiredCandidate,
      match,
      now: input.now,
    });
    const [updated] = await input.tx
      .update(studioInterview)
      .set(closure.patch)
      .where(
        and(
          eq(studioInterview.id, candidate.id),
          eq(studioInterview.organizationId, input.organizationId),
          eq(studioInterview.outcome, "in_pipeline"),
        ),
      )
      .returning({ id: studioInterview.id });
    if (!updated) {
      continue;
    }
    closed.push({
      candidateId: candidate.id,
      candidateName: candidate.name,
      fromOutcome: candidate.outcome,
      fromStage: candidate.pipelineStage,
      match,
    });
    auditRows.push({
      action: "candidate_transition",
      createdAt: input.now,
      detail: closure.auditDetail,
      id: crypto.randomUUID(),
      interviewRecordId: candidate.id,
      operatorId: input.operatorId,
      operatorRole: input.operatorRole ?? null,
      organizationId: input.organizationId,
      scheduleEntryId: null,
      source: "system",
    });
  }
  if (auditRows.length > 0) {
    await input.tx.insert(interviewAuditLog).values(auditRows);
  }
  return closed;
}
