import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { buildResumeParseQueuePrefix, createRedisConnectionFromUrl } from "./resume-parse";

export const HUMAN_INTERVIEW_REMINDER_QUEUE = "human-interview-reminders";
export const humanInterviewReminderJobSchema = z.object({
  meetingId: z.string().min(1),
  revision: z.number().int().positive(),
});
export type HumanInterviewReminderJob = z.infer<typeof humanInterviewReminderJobSchema>;
let queue: Queue<HumanInterviewReminderJob> | undefined;
const limiterClients = new WeakSet<object>();

function connection() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  return createRedisConnectionFromUrl(url);
}

export function humanInterviewReminderJobId(data: HumanInterviewReminderJob) {
  return `meeting-${Buffer.from(data.meetingId).toString("base64url")}-v${data.revision}`;
}

export function getHumanInterviewReminderQueue() {
  if (!queue) {
    queue = new Queue<HumanInterviewReminderJob>(HUMAN_INTERVIEW_REMINDER_QUEUE, {
      connection: connection(),
      prefix: buildResumeParseQueuePrefix(),
    });
    queue.on("error", () =>
      console.error("[human-interview-reminders] queue producer connection error"),
    );
  }
  return queue;
}

export async function ensureHumanInterviewReminderJob(
  data: HumanInterviewReminderJob,
  scheduledAt: Date,
) {
  const reminderQueue = getHumanInterviewReminderQueue();
  const jobId = humanInterviewReminderJobId(data);
  const existing = await reminderQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed" || state === "completed") {
      // The DB still considers this schedule unfinished (e.g. result persistence failed).
      await existing.retry(state);
    }
    return;
  }
  await reminderQueue.add("notify-meeting", data, {
    attempts: 20,
    backoff: { delay: 60_000, type: "fixed" },
    delay: Math.max(0, scheduledAt.getTime() - 10 * 60_000 - Date.now()),
    jobId,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 2000 },
  });
}

export async function removeHumanInterviewReminderJob(data: HumanInterviewReminderJob) {
  const job = await getHumanInterviewReminderQueue().getJob(humanInterviewReminderJobId(data));
  if (!job) {
    return;
  }
  try {
    await job.remove();
  } catch (error) {
    // Active jobs cannot be removed; the processor checks the persisted version before sending.
    if ((await job.getState()) !== "active") {
      throw error;
    }
  }
}

// Shared across reminder workers, including a per-chat limit. No TG credentials in Redis keys.
export async function waitForHumanInterviewReminderSend(chatId: string) {
  const client = await getHumanInterviewReminderQueue().client;
  const prefix = `${buildResumeParseQueuePrefix()}:human-reminder-send`;
  const chatKey = `${prefix}:${createHash("sha256").update(chatId).digest("hex")}`;
  if (!limiterClients.has(client)) {
    client.defineCommand("acquireHumanReminderSlot", {
      lua: `
      local chatWait = redis.call('PTTL', KEYS[2])
      if chatWait > 0 then return chatWait end
      if tonumber(redis.call('GET', KEYS[1]) or '0') >= 20 then
        return math.max(1, redis.call('PTTL', KEYS[1]))
      end
      if redis.call('INCR', KEYS[1]) == 1 then redis.call('PEXPIRE', KEYS[1], 1000) end
      redis.call('SET', KEYS[2], '1', 'PX', 1000)
      return 0
    `,
      numberOfKeys: 2,
    });
    limiterClients.add(client);
  }
  for (;;) {
    const wait = Number(await client.runCommand("acquireHumanReminderSlot", [prefix, chatKey]));
    if (wait === 0) {
      return;
    }
    await setTimeout(wait);
  }
}

export function createHumanInterviewReminderWorker(
  processJob: (data: HumanInterviewReminderJob) => Promise<void>,
) {
  const worker = new Worker<HumanInterviewReminderJob>(
    HUMAN_INTERVIEW_REMINDER_QUEUE,
    (job) => processJob(humanInterviewReminderJobSchema.parse(job.data)),
    {
      concurrency: 4,
      connection: connection(),
      prefix: buildResumeParseQueuePrefix(),
    },
  );
  worker.on("error", () => console.error("[human-interview-reminders] queue connection error"));
  worker.on("failed", (job) =>
    console.error("[human-interview-reminders] job will retry or needs recovery", {
      meetingId: job?.data.meetingId,
      revision: job?.data.revision,
    }),
  );
  return worker;
}

export async function closeHumanInterviewReminderQueue() {
  await queue?.close();
  queue = undefined;
}
