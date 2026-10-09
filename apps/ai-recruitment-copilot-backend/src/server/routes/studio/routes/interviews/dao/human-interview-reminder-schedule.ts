import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioHumanInterviewReminderSchedule as schedule } from "@arc/db-schema/schema";
import {
  ensureHumanInterviewReminderJob,
  removeHumanInterviewReminderJob,
} from "@arc/resume-parse-queue/human-interview-reminders";
import type { HumanInterviewReminderJob } from "@arc/resume-parse-queue/human-interview-reminders";

// Reads only indexed outbox entries. Normal notification execution is driven by BullMQ.
export async function syncHumanInterviewReminderSchedules(now = new Date()) {
  const rows = await db
    .select()
    .from(schedule)
    .where(lte(schedule.nextSyncAt, now))
    .orderBy(asc(schedule.nextSyncAt))
    .limit(100);
  for (const row of rows) {
    try {
      const job = { meetingId: row.meetingId, revision: row.revision };
      const oldRevisions = new Set([row.queuedRevision, row.revision - 1]);
      for (const revision of oldRevisions) {
        if (revision && revision !== row.revision) {
          await removeHumanInterviewReminderJob({ meetingId: row.meetingId, revision });
        }
      }
      const active = row.active && row.scheduledAt && row.scheduledAt > now;
      await (active && row.scheduledAt
        ? ensureHumanInterviewReminderJob(job, row.scheduledAt)
        : removeHumanInterviewReminderJob(job));
      await db
        .update(schedule)
        .set({
          errorCode: null,
          // Recover lost Redis jobs after their due time, without checking every future meeting.
          nextSyncAt:
            active && row.scheduledAt
              ? new Date(Math.max(now.getTime() + 120_000, row.scheduledAt.getTime() - 9 * 60_000))
              : null,
          queuedRevision: row.revision,
        })
        .where(
          and(
            eq(schedule.meetingId, row.meetingId),
            eq(schedule.revision, row.revision),
            isNotNull(schedule.nextSyncAt),
          ),
        );
    } catch {
      await db
        .update(schedule)
        .set({
          errorCode: "queue_sync_failed",
          nextSyncAt: new Date(now.getTime() + 60_000),
        })
        .where(
          and(
            eq(schedule.meetingId, row.meetingId),
            eq(schedule.revision, row.revision),
            isNotNull(schedule.nextSyncAt),
          ),
        );
      console.error("[human-interview-reminders] outbox sync failed", { meetingId: row.meetingId });
    }
  }
  return rows.length === 100;
}

export async function completeHumanInterviewReminderSchedule(job: HumanInterviewReminderJob) {
  await db
    .update(schedule)
    .set({ errorCode: null, nextSyncAt: null })
    .where(and(eq(schedule.meetingId, job.meetingId), eq(schedule.revision, job.revision)));
}

export function listenForHumanInterviewReminderChanges(wake: () => void) {
  return db.$client.listen("human_interview_reminder_changed", wake, wake);
}
