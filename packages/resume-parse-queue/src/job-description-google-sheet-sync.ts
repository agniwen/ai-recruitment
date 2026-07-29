import { Queue, Worker } from "bullmq";
import type { JobsOptions } from "bullmq";
import { z } from "zod";
import {
  buildResumeParseQueuePrefix,
  createRedisConnectionFromUrl,
  isResumeParseQueueConfigured,
} from "./resume-parse";

export const JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_QUEUE_NAME = "job-description-google-sheet-sync";
export const JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_JOB_NAME = "sync-job-descriptions";

export const jobDescriptionGoogleSheetSyncJobSchema = z.object({
  runId: z.string().min(1),
});

export type JobDescriptionGoogleSheetSyncJobData = z.infer<
  typeof jobDescriptionGoogleSheetSyncJobSchema
>;
export type JobDescriptionGoogleSheetSyncJobProcessor = (
  payload: JobDescriptionGoogleSheetSyncJobData,
) => Promise<void>;

let queue: Queue<JobDescriptionGoogleSheetSyncJobData> | null = null;

function createRedisConnection(env: NodeJS.ProcessEnv = process.env) {
  const url = env.REDIS_URL?.trim();
  if (!url) {
    throw new Error("REDIS_URL is not set.");
  }
  return createRedisConnectionFromUrl(url);
}

function jobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 2000 },
  };
}

export function buildJobDescriptionGoogleSheetSyncJobId({
  runId,
}: JobDescriptionGoogleSheetSyncJobData): string {
  return runId.replaceAll(":", "-");
}

export function resolveJobDescriptionGoogleSheetSyncWorkerConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  const value = Number.parseInt(
    env.JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_WORKER_CONCURRENCY || "1",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function isJobDescriptionGoogleSheetSyncQueueConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isResumeParseQueueConfigured(env);
}

export function getJobDescriptionGoogleSheetSyncQueue(): Queue<JobDescriptionGoogleSheetSyncJobData> {
  if (!queue) {
    queue = new Queue<JobDescriptionGoogleSheetSyncJobData>(
      JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_QUEUE_NAME,
      {
        connection: createRedisConnection(),
        prefix: buildResumeParseQueuePrefix(),
      },
    );
  }
  return queue;
}

export async function enqueueJobDescriptionGoogleSheetSyncJob(
  data: JobDescriptionGoogleSheetSyncJobData,
): Promise<void> {
  if (!isJobDescriptionGoogleSheetSyncQueueConfigured()) {
    throw new Error("REDIS_URL is not set.");
  }
  await getJobDescriptionGoogleSheetSyncQueue().add(
    JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_JOB_NAME,
    data,
    {
      ...jobOptions(),
      jobId: buildJobDescriptionGoogleSheetSyncJobId(data),
    },
  );
}

const IN_FLIGHT_JOB_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children",
]);

/**
 * Idempotent enqueue: keep existing in-flight jobs, replace finished/missing ones.
 * Prevents DB-active / Redis-missing zombies from blocking the UI forever.
 */
export async function ensureJobDescriptionGoogleSheetSyncJobEnqueued(
  data: JobDescriptionGoogleSheetSyncJobData,
): Promise<"already_inflight" | "enqueued"> {
  if (!isJobDescriptionGoogleSheetSyncQueueConfigured()) {
    throw new Error("REDIS_URL is not set.");
  }
  const queue = getJobDescriptionGoogleSheetSyncQueue();
  const jobId = buildJobDescriptionGoogleSheetSyncJobId(data);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (IN_FLIGHT_JOB_STATES.has(state)) {
      return "already_inflight";
    }
    await existing.remove();
  }
  await queue.add(JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_JOB_NAME, data, {
    ...jobOptions(),
    jobId,
  });
  return "enqueued";
}

export function createJobDescriptionGoogleSheetSyncWorker(
  processJob: JobDescriptionGoogleSheetSyncJobProcessor,
): Worker<JobDescriptionGoogleSheetSyncJobData> {
  const concurrency = resolveJobDescriptionGoogleSheetSyncWorkerConcurrency();
  const worker = new Worker<JobDescriptionGoogleSheetSyncJobData>(
    JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_QUEUE_NAME,
    async (job) => {
      await processJob(jobDescriptionGoogleSheetSyncJobSchema.parse(job.data));
    },
    {
      concurrency,
      connection: createRedisConnection(),
      prefix: buildResumeParseQueuePrefix(),
    },
  );

  worker.on("ready", () => {
    console.info("[job-description-google-sheet-sync-worker] ready", {
      concurrency,
      queue: JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_QUEUE_NAME,
    });
  });
  worker.on("failed", (job, error) => {
    console.error("[job-description-google-sheet-sync-worker] job failed", {
      error,
      jobId: job?.id,
      runId: job?.data.runId,
    });
  });

  return worker;
}

export async function closeJobDescriptionGoogleSheetSyncQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}
