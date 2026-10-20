import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { serializeErrorDetails } from "@arc/ai-recruitment-copilot-backend/lib/server/error-reporting";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { SmartRecommendationResult } from "@arc/db-schema/job-matching";
import { QdrantResumeVectorStore } from "@arc/ai-recruitment-copilot-backend/lib/server/qdrant/resume-vector-store";
import {
  embedResumeSemanticTexts,
  isResumeSemanticIndexEnabled,
} from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/embedding";
import { getResumeSemanticIndexConfig } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer";
import { buildResumeSemanticTexts } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/text-builders";
import {
  ensureJobMatchingProfile,
  matchingProfileSourceHash,
} from "../../job-descriptions/utils/matching-profile";
import { enqueueJobDescriptionIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue";
import { loadEligibleSmartJobs } from "./jobs";
import type { EligibleSmartJob } from "./jobs";
import {
  buildJobMatchingText,
  buildResumeMatchingText,
  checkExistingScreeningPolicy,
  checkJobRequirements,
  rankJobEvidence,
  resumeMatchingFacts,
} from "./matching";
import { rerankJobDocuments } from "./rerank";

async function scopedVectorHits(
  resume: ResumeProfile,
  organizationId: string,
  jobs: EligibleSmartJob[],
) {
  const config = getResumeSemanticIndexConfig();
  if (!isResumeSemanticIndexEnabled() || !config.qdrantUrl) {
    return [];
  }
  const store = new QdrantResumeVectorStore({
    apiKey: config.qdrantApiKey,
    collectionName: config.qdrantCollectionName,
    dimensions: config.dimensions,
    url: config.qdrantUrl,
  });
  const chunks = await embedResumeSemanticTexts({
    ...config,
    chunks: buildResumeSemanticTexts(resume),
  });
  const hits = await Promise.all(
    chunks.map((chunk) =>
      store.searchSimilarResumes({
        allowedSourceIds: jobs.map((entry) => entry.job.id),
        chunkType: chunk.chunkType,
        embedding: chunk.embedding,
        embeddingVersion: config.embeddingVersion,
        limit: 30,
        organizationId,
        sourceTypes: ["job_description"],
      }),
    ),
  );
  return [
    ...new Set(
      hits
        .flat()
        .toSorted((a, b) => b.score - a.score)
        .map((hit) => hit.sourceId),
    ),
  ];
}

export function shortlistSmartJobs(
  jobs: EligibleSmartJob[],
  resume: ResumeProfile,
  vectorIds: string[],
) {
  const skills = [
    ...new Set([
      ...resume.skills,
      ...resume.targetRoles,
      ...resumeMatchingFacts(resume)
        .filter((f) => f.field.endsWith(".role"))
        .map((f) => f.quote),
    ]),
  ].map((text) => text.toLowerCase());
  const keyword = jobs
    .map((entry) => {
      const text = buildJobMatchingText(entry.job, entry.matching?.profile).toLowerCase();
      return {
        entry,
        score: skills.reduce((score, skill) => score + (text.includes(skill) ? 1 : 0), 0),
      };
    })
    .toSorted((a, b) => b.score - a.score);
  const byId = new Map(jobs.map((entry) => [entry.job.id, entry]));
  // Reserve a lexical path for exact tools/job titles; every vector hit must still be scoped.
  const ids = [
    ...new Set([
      ...vectorIds.filter((id) => byId.has(id)).slice(0, 30),
      ...keyword.slice(0, 20).map((entry) => entry.entry.job.id),
    ]),
  ];
  return ids
    .flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    })
    .slice(0, 50);
}

export async function recommendSmartJobs(
  resume: ResumeProfile,
  organizationId: string,
  userId: string,
): Promise<SmartRecommendationResult> {
  const eligible = await loadEligibleSmartJobs(organizationId, userId);
  const policyChecks = new Map(
    eligible.map((entry) => [
      entry.job.id,
      checkExistingScreeningPolicy(resume, entry.job.resumeScreeningPolicy),
    ]),
  );
  const available = eligible.filter((entry) => !policyChecks.get(entry.job.id)?.blocked);
  let retrieval: SmartRecommendationResult["retrieval"] = "direct";
  let shortlist = available;
  if (available.length > 50) {
    let vectorIds: string[] = [];
    try {
      vectorIds = await scopedVectorHits(resume, organizationId, available);
    } catch {
      // A missing/unavailable index must not widen the authorized candidate set.
    }
    retrieval = vectorIds.length ? "hybrid" : "keyword_fallback";
    shortlist = shortlistSmartJobs(available, resume, vectorIds);
  }
  const limit = pLimit(3);
  const profileResults = await Promise.allSettled(
    shortlist.map((entry) =>
      limit(async () => {
        const matching =
          entry.matching &&
          (entry.matching.confirmedAt ||
            entry.matching.sourceHash === matchingProfileSourceHash(entry.job))
            ? entry.matching
            : await ensureJobMatchingProfile(entry.job);
        if (
          !entry.matching ||
          entry.matching.updatedAt.getTime() !== matching.updatedAt.getTime()
        ) {
          await enqueueJobDescriptionIndexJobBestEffort({
            jobDescriptionId: entry.job.id,
            organizationId,
          });
        }
        return { ...entry, matching };
      }),
    ),
  );
  const profiled = profileResults.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [result.value];
    }
    console.warn("[smart-resume-upload] job profile unavailable", {
      errorDetails: serializeErrorDetails(result.reason).chain.map(
        ({ code, message, name, status }) => ({ code, message, name, status }),
      ),
      jobDescriptionId: shortlist[index]?.job.id,
      organizationId,
    });
    return [];
  });
  if (shortlist.length > 0 && profiled.length === 0) {
    throw new Error("候选岗位画像暂不可用，请稍后重试。");
  }
  const currentJobs = await loadEligibleSmartJobs(organizationId, userId);
  const allowedNow = new Set(currentJobs.map((entry) => entry.job.id));
  const candidates = profiled
    .filter((entry) => allowedNow.has(entry.job.id))
    .map((entry) => ({
      ...entry,
      checks: checkJobRequirements(
        resume,
        entry.matching.profile,
        Boolean(entry.matching.confirmedAt),
      ),
    }))
    .filter((entry) => !entry.checks.blocked);
  const ranked = await rerankJobDocuments(
    buildResumeMatchingText(resume),
    candidates.map((entry) => buildJobMatchingText(entry.job, entry.matching.profile)),
  );
  const recommendations = ranked.results
    .filter((result) => result.relevance_score >= 0.15)
    .slice(0, 3)
    .flatMap((rank) => {
      const entry = candidates[rank.index];
      if (!entry) {
        return [];
      }
      return [
        {
          jobDescriptionId: entry.job.id,
          ...rankJobEvidence(resume, entry.matching.profile),
          profileHash: createHash("sha256")
            .update(JSON.stringify(entry.matching.profile))
            .digest("hex"),
          score: rank.relevance_score,
          warnings: [
            ...entry.checks.warnings,
            ...(policyChecks.get(entry.job.id)?.warnings ?? []),
            ...(entry.matching.sourceHash === matchingProfileSourceHash(entry.job)
              ? []
              : ["岗位内容已更新，画像待确认"]),
          ],
        },
      ];
    });
  return {
    eligibleCount: eligible.length,
    model: ranked.model,
    recommendations,
    rerankedCount: candidates.length,
    retrieval,
    tokenUsage: ranked.tokens,
    version: "smart-upload-v1",
  };
}
