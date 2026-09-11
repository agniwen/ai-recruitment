import {
  getResumeParseQueue,
  isResumeParseQueueConfigured,
} from "@arc/resume-parse-queue/resume-parse";
import { cancelQueuedUploadItems } from "../studio/routes/resume-upload-batches/dao/cancel-queued";

export async function clearPendingParseJobs() {
  if (!isResumeParseQueueConfigured()) {
    throw new Error("Redis 未配置");
  }
  const queue = getResumeParseQueue();
  const wasPaused = await queue.isPaused();
  await queue.pause();
  let removed = 0;
  try {
    // Pausing prevents workers from claiming the snapshot while DB cancellation is persisted.
    const jobs = await queue.getJobs(
      ["waiting", "paused", "delayed", "prioritized", "waiting-children"],
      0,
      -1,
      true,
    );
    await cancelQueuedUploadItems(jobs.map((job) => job.data.itemId));
    for (const job of jobs) {
      await job.remove({ removeChildren: false });
      removed += 1;
    }
    return { removed };
  } finally {
    if (!wasPaused) {
      await queue.resume();
    }
  }
}
