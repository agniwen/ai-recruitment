import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import {
  closeResumeParseQueue,
  configureHistoricalResumeParseGlobalConcurrency,
  createResumeParseWorker,
  isResumeParseQueueConfigured,
  RESUME_PARSE_HISTORICAL_QUEUE_NAME,
  tryWithHistoricalResumeDiscoveryLock,
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
import { resolveLegacyParseConfig, resolveWorkerServerConfig } from "./config";
import { getWorkerConnectionSummary, loadWorkerEnv } from "./env";
import { getResumeParseConfigSummary } from "./parse-config";
import { startMailIngestScheduler } from "./mail-ingest/scheduler";
import type { MailIngestScheduler } from "./mail-ingest/scheduler";

loadWorkerEnv();

const LEGACY_DISCOVERY_INTERVAL_MS = 5 * 60 * 1000;
const LEGACY_QUEUE_REFILL_INTERVAL_MS = 60 * 1000;

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

async function refillHistoricalResumeParseQueue(input: {
  highWatermark: number;
  lowWatermark: number;
}): Promise<void> {
  const { recoverIncompleteHistoricalBatchItems } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches");
  const { enqueueResumeParseJobs, getResumeParseQueueOpenCount, listOpenResumeParseJobItemIds } =
    await import("@arc/resume-parse-queue/resume-parse");
  const openCount = await getResumeParseQueueOpenCount({
    queueName: RESUME_PARSE_HISTORICAL_QUEUE_NAME,
  });
  if (openCount > input.lowWatermark) {
    console.info("[historical-resume-worker] queue refill not needed", {
      highWatermark: input.highWatermark,
      lowWatermark: input.lowWatermark,
      openCount,
    });
    return;
  }
  const openItemIds = await listOpenResumeParseJobItemIds({
    queueName: RESUME_PARSE_HISTORICAL_QUEUE_NAME,
  });
  const jobs = await recoverIncompleteHistoricalBatchItems({
    excludeItemIds: openItemIds,
    limit: Math.max(0, input.highWatermark - openCount),
  });
  if (jobs.length === 0) {
    console.info("[historical-resume-worker] queue refill found no pending items", { openCount });
    return;
  }
  await enqueueResumeParseJobs(jobs, { queueName: RESUME_PARSE_HISTORICAL_QUEUE_NAME });
  console.info("[historical-resume-worker] queue refilled", {
    enqueued: jobs.length,
    openCountBefore: openCount,
    target: input.highWatermark,
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
  const legacyParseConfig = resolveLegacyParseConfig();
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
  let historicalMaintenanceTimer: NodeJS.Timeout | null = null;
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
    if (legacyParseConfig) {
      await configureHistoricalResumeParseGlobalConcurrency(12);
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
      let historicalMaintenanceRunning = false;
      let lastHistoricalDiscoveryAt = 0;
      const runHistoricalMaintenance = async (): Promise<void> => {
        if (historicalMaintenanceRunning) {
          return;
        }
        historicalMaintenanceRunning = true;
        try {
          const maintenance = await tryWithHistoricalResumeDiscoveryLock(
            legacyParseConfig.workspaceSlug,
            async () => {
              const discoveryDue =
                Date.now() - lastHistoricalDiscoveryAt >= LEGACY_DISCOVERY_INTERVAL_MS;
              if (discoveryDue) {
                const { importLegacyResumes } =
                  await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/utils/legacy-import");
                const result = await importLegacyResumes({
                  commit: true,
                  uploaderEmail: legacyParseConfig.uploaderEmail,
                  workspaceSlug: legacyParseConfig.workspaceSlug,
                });
                lastHistoricalDiscoveryAt = Date.now();
                console.info("[historical-resume-worker] automatic discovery finished", result);
              }
              await refillHistoricalResumeParseQueue({
                highWatermark: legacyParseConfig.queueHighWatermark,
                lowWatermark: legacyParseConfig.queueLowWatermark,
              });
            },
          );
          if (!maintenance.acquired) {
            console.info("[historical-resume-worker] queue maintenance handled by another worker");
          }
        } finally {
          historicalMaintenanceRunning = false;
        }
      };
      await runHistoricalMaintenance();
      const runPeriodicHistoricalMaintenance = async (): Promise<void> => {
        try {
          await runHistoricalMaintenance();
        } catch (error) {
          console.error("[historical-resume-worker] automatic discovery or recovery failed", {
            error,
          });
        }
      };
      historicalMaintenanceTimer = setInterval(
        () => void runPeriodicHistoricalMaintenance(),
        LEGACY_QUEUE_REFILL_INTERVAL_MS,
      );
      historicalMaintenanceTimer.unref();
    } else {
      console.info("[historical-resume-worker] disabled by ENABLE_LEGACY_PARSE");
    }
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
        if (historicalMaintenanceTimer) {
          clearInterval(historicalMaintenanceTimer);
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
