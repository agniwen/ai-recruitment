import pLimit from "p-limit";
import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { resumeSemanticIndex } from "@arc/db-schema/schema";
import { ensureJobMatchingProfile } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/utils/matching-profile";
import { getResumeSemanticIndexConfig } from "../resume-semantic/indexer";
import { createDefaultJdIndexerDeps, runJdSemanticIndexJob } from "./indexer";
import type { JdSemanticIndexJob } from "./indexer";

// Keep bulk initialization from consuming the worker's full resume-index concurrency.
const rebuildLimit = pLimit(3);

export async function runJobMatchingIndexRebuild(job: JdSemanticIndexJob) {
  await rebuildLimit(async () => {
    const config = getResumeSemanticIndexConfig();
    try {
      const deps = createDefaultJdIndexerDeps();
      await runJdSemanticIndexJob(job, {
        ...deps,
        loadSource: async (input) => {
          const source = await deps.loadSource(input);
          if (!source) {
            return null;
          }
          const matching = await ensureJobMatchingProfile({
            description: source.description ?? null,
            id: source.id,
            name: source.name,
            prompt: source.prompt,
          });
          return { ...source, matchingProfileText: JSON.stringify(matching.profile) };
        },
        // A DB index marker is not proof that this Qdrant deployment has its points.
        readIndexState: () => Promise.resolve(null),
      });
    } catch (error) {
      // Extraction precedes the indexer's own error handler; retain that failure too.
      await db
        .update(resumeSemanticIndex)
        .set({
          errorMessage: error instanceof Error ? error.message : "岗位画像或向量生成失败。",
          status: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(resumeSemanticIndex.organizationId, job.organizationId),
            eq(resumeSemanticIndex.sourceId, job.sourceId),
            eq(resumeSemanticIndex.sourceType, "job_description"),
            eq(resumeSemanticIndex.embeddingVersion, config.embeddingVersion),
          ),
        );
      throw error;
    }
  });
}
