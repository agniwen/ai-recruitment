import { and, count, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { findSemanticResumeDuplicates } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/dedup-service";
import { replaceDuplicateMatchesForSource } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/duplicate-matches";
import { isResumeSemanticIndexEnabled } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/embedding";
import { getResumeSemanticIndexConfig } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer";
import { studioInterview } from "@arc/db-schema/schema";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { StudioInterviewResumeSourceType } from "@arc/db-schema/schema";
import {
  AUTO_CLOSE_RESUME_SIMILARITY_THRESHOLD,
  isDirectUploadCandidate,
} from "./related-candidate-auto-closure-policy";

export interface RefreshedSemanticDuplicateMatch {
  candidateId: string;
  similarityScore: number;
}

interface DirectUploadDedupRefreshDeps {
  enabled: boolean;
  findDuplicates: typeof findSemanticResumeDuplicates;
  loadCandidate: (input: { candidateId: string; organizationId: string }) => Promise<{
    candidateCount: number;
    poolItemId: string | null;
    profile: ResumeProfile | null;
    sourceType: StudioInterviewResumeSourceType | null;
  } | null>;
  replaceDuplicateSnapshot: typeof replaceDuplicateMatchesForSource;
}

async function loadCandidate(input: { candidateId: string; organizationId: string }) {
  const [[candidate], [candidateCountRow]] = await Promise.all([
    db
      .select({
        poolItemId: studioInterview.resumeSourcePoolItemId,
        profile: studioInterview.resumeProfile,
        sourceType: studioInterview.resumeSourceType,
      })
      .from(studioInterview)
      .where(
        and(
          eq(studioInterview.id, input.candidateId),
          eq(studioInterview.organizationId, input.organizationId),
        ),
      )
      .limit(1),
    db
      .select({ value: count() })
      .from(studioInterview)
      .where(eq(studioInterview.organizationId, input.organizationId)),
  ]);
  return candidate
    ? { ...candidate, candidateCount: Math.max(1, candidateCountRow?.value ?? 1) }
    : null;
}

const defaultDeps: DirectUploadDedupRefreshDeps = {
  enabled: isResumeSemanticIndexEnabled() && Boolean(getResumeSemanticIndexConfig().qdrantUrl),
  findDuplicates: findSemanticResumeDuplicates,
  loadCandidate,
  replaceDuplicateSnapshot: replaceDuplicateMatchesForSource,
};

export async function refreshDirectUploadDuplicateMatchesBeforeHire(
  input: { candidateId: string; organizationId: string },
  deps: DirectUploadDedupRefreshDeps = defaultDeps,
): Promise<RefreshedSemanticDuplicateMatch[] | undefined> {
  const candidate = await deps.loadCandidate(input);
  if (
    !candidate?.profile ||
    !isDirectUploadCandidate({
      poolItemId: candidate.poolItemId,
      sourceType: candidate.sourceType,
    })
  ) {
    return;
  }
  if (!deps.enabled) {
    return;
  }

  const matches = await deps.findDuplicates({
    excludeSources: [{ sourceId: input.candidateId, sourceType: "studio_interview" }],
    organizationId: input.organizationId,
    resultLimit: candidate.candidateCount,
    resumeProfile: candidate.profile,
    sourceTypes: ["studio_interview"],
    throwOnError: true,
  });
  await deps.replaceDuplicateSnapshot({
    matches,
    organizationId: input.organizationId,
    sourceId: input.candidateId,
    sourceType: "studio_interview",
  });
  return matches
    .filter(
      (match) =>
        match.sourceType === "studio_interview" &&
        (match.score ?? 0) >= AUTO_CLOSE_RESUME_SIMILARITY_THRESHOLD,
    )
    .map((match) => ({ candidateId: match.id, similarityScore: match.score ?? 0 }))
    .toSorted((left, right) => left.candidateId.localeCompare(right.candidateId));
}
