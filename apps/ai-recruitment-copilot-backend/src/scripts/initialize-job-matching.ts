import { pathToFileURL } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { jobDescription, organization } from "@arc/db-schema/schema";
import { hashJobDescriptionForSemanticIndex } from "../lib/server/jd-semantic/hash";
import { buildJobDescriptionSemanticTexts } from "../lib/server/resume-semantic/text-builders";
import type { JobDescriptionSemanticInput } from "../lib/server/resume-semantic/text-builders";
import type { ResumeStoredEmbeddingChunk } from "../lib/server/resume-semantic/vector-store";
import { loadStandaloneEnv } from "../standalone/env";
import {
  parseSemanticBackfillConcurrency,
  runJdSemanticBackfillRecords,
} from "./backfill-jd-semantic-index";

export function hasCurrentJobVectors(
  source: JobDescriptionSemanticInput,
  chunks: ResumeStoredEmbeddingChunk[],
  config: { dimensions: number; model: string; embeddingVersion: string },
) {
  const expected = buildJobDescriptionSemanticTexts(source);
  const profileHash = hashJobDescriptionForSemanticIndex(source);
  return (
    chunks.length === expected.length &&
    expected.every((chunk) =>
      chunks.some(
        (stored) =>
          stored.chunkType === chunk.chunkType &&
          stored.profileHash === profileHash &&
          stored.embeddingModel === config.model &&
          stored.embeddingVersion === config.embeddingVersion &&
          stored.embedding.length === config.dimensions &&
          stored.status === "active",
      ),
    )
  );
}

async function initializeJobMatching() {
  loadStandaloneEnv();
  const slug = process.env.JOB_MATCHING_WORKSPACE?.trim();
  if (!slug) {
    throw new Error("Set JOB_MATCHING_WORKSPACE to the workspace slug.");
  }
  const rawLimit = process.env.JOB_MATCHING_LIMIT;
  const limit = rawLimit ? Number(rawLimit) : undefined;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("JOB_MATCHING_LIMIT must be a positive integer.");
  }
  const execute = process.env.JOB_MATCHING_EXECUTE === "true";
  const concurrency = parseSemanticBackfillConcurrency(process.env.JOB_MATCHING_CONCURRENCY ?? "4");
  const { db, closeDatabase } = await import("../lib/server/db");
  try {
    const { selectableJobDescriptionCondition } =
      await import("../server/routes/studio/routes/job-descriptions/dao");
    const [workspace] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug));
    if (!workspace) {
      throw new Error("Workspace not found.");
    }
    const jobs = await db
      .select()
      .from(jobDescription)
      .where(
        and(eq(jobDescription.organizationId, workspace.id), selectableJobDescriptionCondition),
      )
      .orderBy(asc(jobDescription.id));
    const selected = limit ? jobs.slice(0, limit) : jobs;
    console.log(
      JSON.stringify({
        concurrency,
        event: "initialization_plan",
        execute,
        jobs: selected.length,
        workspace: slug,
      }),
    );
    if (!execute) {
      return;
    }
    const [
      { ensureJobMatchingProfile },
      { createDefaultJdIndexerDeps, runJdSemanticIndexJob },
      { QdrantResumeVectorStore },
    ] = await Promise.all([
      import("../server/routes/studio/routes/job-descriptions/utils/matching-profile"),
      import("../lib/server/jd-semantic/indexer"),
      import("../lib/server/qdrant/resume-vector-store"),
    ]);
    const deps = createDefaultJdIndexerDeps();
    const config = deps.getConfig();
    const store = new QdrantResumeVectorStore({
      apiKey: config.qdrantApiKey,
      collectionName: config.qdrantCollectionName,
      dimensions: config.dimensions,
      url: config.qdrantUrl,
    });
    await store.ensureCollection();
    let completed = 0;
    let rebuilt = 0;
    const byId = new Map(selected.map((job) => [job.id, job]));
    const summary = await runJdSemanticBackfillRecords({
      concurrency,
      indexRecord: async (record) => {
        const job = byId.get(record.sourceId);
        if (!job) {
          throw new Error("Job is outside the selected workspace.");
        }
        await ensureJobMatchingProfile(job);
        const source = await deps.loadSource(record);
        if (!source) {
          throw new Error("Job is no longer selectable.");
        }
        const loadInput = { ...record, embeddingVersion: config.embeddingVersion };
        const chunks = await store.loadResumeEmbeddings(loadInput);
        const profileHash = hashJobDescriptionForSemanticIndex(source);
        const state = await deps.readIndexState({ ...loadInput, profileHash });
        if (
          !hasCurrentJobVectors(source, chunks, config) ||
          state?.status !== "indexed" ||
          state.profileHash !== profileHash
        ) {
          // A restored DB marker does not prove that this Qdrant instance has the vectors.
          await runJdSemanticIndexJob(record, {
            ...deps,
            readIndexState: () => Promise.resolve(null),
          });
          rebuilt += 1;
        }
        if (!hasCurrentJobVectors(source, await store.loadResumeEmbeddings(loadInput), config)) {
          throw new Error("Job vectors failed verification after indexing.");
        }
      },
      log: (entry) => {
        if (entry.event === "record_failed" || entry.event === "record_succeeded") {
          completed += 1;
          if (entry.event === "record_failed" || completed % 10 === 0) {
            console.log(JSON.stringify({ ...entry, completed, rebuilt }));
          }
        }
      },
      records: selected.map((job) => ({
        organizationId: workspace.id,
        sourceId: job.id,
        sourceType: "job_description",
      })),
    });
    console.log(
      JSON.stringify({ event: "initialization_finished", rebuilt, workspace: slug, ...summary }),
    );
    if (summary.failed) {
      process.exitCode = 1;
    }
  } finally {
    await closeDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await initializeJobMatching();
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "initialization_failed",
      }),
    );
    process.exitCode = 1;
  }
}
