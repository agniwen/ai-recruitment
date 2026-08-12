import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import {
  closeResumeParseQueue,
  configureHistoricalResumeParseGlobalConcurrency,
  createResumeParseWorker,
  isResumeParseQueueConfigured,
  RESUME_PARSE_HISTORICAL_QUEUE_NAME,
  withHistoricalResumeObjectLock,
} from "@arc/resume-parse-queue/resume-parse";
import {
  closeResumeSemanticIndexQueue,
  createResumeSemanticIndexWorker,
  enqueueResumeSemanticIndexJobs,
} from "@arc/resume-parse-queue/resume-semantic-index";
import {
  closeResumeReviewGenerationQueue,
  createResumeReviewGenerationWorker,
} from "@arc/resume-parse-queue/resume-review-generation";
import {
  closeJobDescriptionGoogleSheetSyncQueue,
  createJobDescriptionGoogleSheetSyncWorker,
} from "@arc/resume-parse-queue/job-description-google-sheet-sync";
import { createWorkerApp } from "./app";
import { resolveWorkerServerConfig } from "./config";
import { getWorkerConnectionSummary, loadWorkerEnv } from "./env";
import { getResumeParseConfigSummary } from "./parse-config";
import { startMailIngestScheduler } from "./mail-ingest/scheduler";
import type { MailIngestScheduler } from "./mail-ingest/scheduler";

loadWorkerEnv();

if (!process.env.TZ) {
  process.env.TZ = "Asia/Shanghai";
}

function isResumeSemanticIndexEnabled(): boolean {
  const value = process.env.RESUME_SEMANTIC_INDEX_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function recoverIncompleteResumeParseJobs(): Promise<void> {
  const { recoverIncompleteBatchItems } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches");
  const { enqueueResumeParseJobs } = await import("@arc/resume-parse-queue/resume-parse");
  const jobs = await recoverIncompleteBatchItems();
  if (jobs.length === 0) {
    console.info("[resume-parse-worker] startup recovery found no pending items");
    return;
  }
  await enqueueResumeParseJobs(jobs);
  console.info("[resume-parse-worker] startup recovery enqueued items", {
    count: jobs.length,
  });
}

async function recoverIncompleteHistoricalResumeParseJobs(): Promise<void> {
  const { recoverIncompleteHistoricalBatchItems } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches");
  const { enqueueResumeParseJobs } = await import("@arc/resume-parse-queue/resume-parse");
  const jobs = await recoverIncompleteHistoricalBatchItems();
  if (jobs.length === 0) {
    console.info("[historical-resume-worker] startup recovery found no pending items");
    return;
  }
  await enqueueResumeParseJobs(jobs, { queueName: RESUME_PARSE_HISTORICAL_QUEUE_NAME });
  console.info("[historical-resume-worker] startup recovery enqueued items", {
    count: jobs.length,
  });
}

async function recoverIncompleteResumeSemanticIndexJobs(): Promise<void> {
  const { listRecoverableResumeSemanticIndexJobs } =
    await import("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/indexer");
  const jobs = await listRecoverableResumeSemanticIndexJobs();
  if (jobs.length === 0) {
    console.info("[resume-semantic-index-worker] startup recovery found no pending sources");
    return;
  }
  await enqueueResumeSemanticIndexJobs(jobs);
  console.info("[resume-semantic-index-worker] startup recovery enqueued sources", {
    count: jobs.length,
  });
}

async function recoverIncompleteGoogleSheetSyncJobs(): Promise<void> {
  const { failStaleGoogleSheetSyncRuns, listActiveGoogleSheetSyncRuns } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/routes/google-sheet-sync/dao");
  const { ensureJobDescriptionGoogleSheetSyncJobEnqueued } =
    await import("@arc/resume-parse-queue/job-description-google-sheet-sync");

  const failedIds = await failStaleGoogleSheetSyncRuns();
  if (failedIds.length > 0) {
    console.info("[job-description-google-sheet-sync-worker] startup marked stale runs failed", {
      count: failedIds.length,
      runIds: failedIds,
    });
  }

  const active = await listActiveGoogleSheetSyncRuns();
  if (active.length === 0) {
    console.info(
      "[job-description-google-sheet-sync-worker] startup recovery found no active runs",
    );
    return;
  }

  let enqueued = 0;
  let alreadyInflight = 0;
  for (const run of active) {
    try {
      const outcome = await ensureJobDescriptionGoogleSheetSyncJobEnqueued({ runId: run.id });
      if (outcome === "enqueued") {
        enqueued += 1;
      } else {
        alreadyInflight += 1;
      }
    } catch (error) {
      console.error("[job-description-google-sheet-sync-worker] startup re-enqueue failed", {
        error,
        runId: run.id,
      });
    }
  }
  console.info("[job-description-google-sheet-sync-worker] startup recovery finished", {
    active: active.length,
    alreadyInflight,
    enqueued,
  });
}

async function main() {
  const { hostname, port } = resolveWorkerServerConfig();
  const app = createWorkerApp();
  const server = serve({
    fetch: app.fetch,
    hostname,
    port,
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[worker] ${hostname}:${port} is already in use.`);
    } else {
      console.error("[worker] server error:", error);
    }
    process.exit(1);
  });
  const closeServer = promisify(server.close.bind(server));

  let worker: ReturnType<typeof createResumeParseWorker> | null = null;
  let historicalWorker: ReturnType<typeof createResumeParseWorker> | null = null;
  let historicalRecoveryTimer: NodeJS.Timeout | null = null;
  let semanticIndexWorker: ReturnType<typeof createResumeSemanticIndexWorker> | null = null;
  let reviewGenerationWorker: ReturnType<typeof createResumeReviewGenerationWorker> | null = null;
  let googleSheetSyncWorker: ReturnType<typeof createJobDescriptionGoogleSheetSyncWorker> | null =
    null;
  let mailIngestScheduler: MailIngestScheduler | null = null;
  if (isResumeParseQueueConfigured()) {
    await recoverIncompleteResumeParseJobs();
    worker = createResumeParseWorker(async ({ bypassCache, itemId }) => {
      const { runBulkResumeUploadWorkflow } =
        await import("@arc/ai-recruitment-copilot-backend/server/agents/mastra/workflows/bulk-resume-upload-workflow");
      await runBulkResumeUploadWorkflow({ bypassCache, itemId });
    });
    await configureHistoricalResumeParseGlobalConcurrency(12);
    await recoverIncompleteHistoricalResumeParseJobs();
    historicalWorker = createResumeParseWorker(
      async ({ itemId }) => {
        const { loadHistoricalImportStorageKey } =
          await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/historical-attempts");
        const storageKey = await loadHistoricalImportStorageKey(itemId);
        if (!storageKey) {
          return;
        }
        await withHistoricalResumeObjectLock(storageKey, async () => {
          const { processHistoricalBatchItem } =
            await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/utils/processor");
          await processHistoricalBatchItem(itemId, process.env.HOSTNAME?.trim() || null);
        });
      },
      { concurrency: 12, queueName: RESUME_PARSE_HISTORICAL_QUEUE_NAME },
    );
    let historicalRecoveryRunning = false;
    const runHistoricalRecovery = async (): Promise<void> => {
      if (historicalRecoveryRunning) {
        return;
      }
      historicalRecoveryRunning = true;
      try {
        await recoverIncompleteHistoricalResumeParseJobs();
      } catch (error) {
        console.error("[historical-resume-worker] periodic recovery failed", { error });
      } finally {
        historicalRecoveryRunning = false;
      }
    };
    historicalRecoveryTimer = setInterval(() => void runHistoricalRecovery(), 60_000);
    historicalRecoveryTimer.unref();
    if (isResumeSemanticIndexEnabled()) {
      await recoverIncompleteResumeSemanticIndexJobs();
      semanticIndexWorker = createResumeSemanticIndexWorker(async (payload) => {
        if (payload.sourceType === "job_description") {
          const { runJdSemanticIndexJob } =
            await import("@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/indexer");
          await runJdSemanticIndexJob(payload as Parameters<typeof runJdSemanticIndexJob>[0]);
          return;
        }
        const { runResumeSemanticEnrichmentJob } =
          await import("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enrichment");
        await runResumeSemanticEnrichmentJob(payload);
      });
    }
    reviewGenerationWorker = createResumeReviewGenerationWorker(async (payload) => {
      const { processResumeReviewGenerationJob } =
        await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/review-worker");
      await processResumeReviewGenerationJob(payload);
    });
    await recoverIncompleteGoogleSheetSyncJobs();
    googleSheetSyncWorker = createJobDescriptionGoogleSheetSyncWorker(async (payload) => {
      const { processGoogleSheetSyncRun } =
        await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/routes/google-sheet-sync/processor");
      await processGoogleSheetSyncRun(payload);
    });
    mailIngestScheduler = startMailIngestScheduler();
  }
  if (!worker) {
    console.warn("[worker] REDIS_URL is not set; resume parse worker is not started.");
    mailIngestScheduler = startMailIngestScheduler();
  }

  console.info(`[worker] listening on http://${hostname}:${port}`);
  console.info("[worker] connection config", getWorkerConnectionSummary());
  console.info("[worker] resume parse config", getResumeParseConfigSummary());

  const shutdown = (signal: NodeJS.Signals) => {
    void (async () => {
      try {
        console.info(`[worker] shutting down after ${signal}`);
        mailIngestScheduler?.close();
        if (historicalRecoveryTimer) {
          clearInterval(historicalRecoveryTimer);
        }
        await closeServer();
        await worker?.close();
        await historicalWorker?.close();
        await semanticIndexWorker?.close();
        await reviewGenerationWorker?.close();
        await googleSheetSyncWorker?.close();
        await closeResumeParseQueue();
        await closeResumeSemanticIndexQueue();
        await closeResumeReviewGenerationQueue();
        await closeJobDescriptionGoogleSheetSyncQueue();
        if (process.env.DATABASE_URL) {
          const { closeDatabase } =
            await import("@arc/ai-recruitment-copilot-backend/lib/server/db");
          await closeDatabase();
        }
        process.exit(0);
      } catch (error) {
        console.error(`[worker] failed to shut down after ${signal}:`, error);
        process.exit(1);
      }
    })();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
