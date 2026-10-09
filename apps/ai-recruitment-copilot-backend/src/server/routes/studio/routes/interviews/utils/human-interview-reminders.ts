import type { HumanInterviewReminderJob } from "@arc/resume-parse-queue/human-interview-reminders";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import { loadHumanInterviewReminderRounds } from "../dao/human-interview-reminders";
import type { HumanInterviewReminder } from "../dao/human-interview-reminders";
import {
  loadHumanInterviewReminderRecipients,
  mergeReminderRecipients,
} from "../dao/human-interview-reminder-recipients";
import type { HumanInterviewReminderRecipient } from "../dao/human-interview-reminder-recipients";
import {
  claimHumanInterviewReminder,
  finishHumanInterviewReminder,
  hasRetryableHumanInterviewReminder,
} from "../dao/human-interview-reminder-delivery";
import { completeHumanInterviewReminderSchedule } from "../dao/human-interview-reminder-schedule";
import { buildHumanInterviewReminderMessage } from "./human-interview-reminder-message";

interface Target {
  recipient: HumanInterviewReminderRecipient;
  reminders: HumanInterviewReminder[];
}

async function loadAudience(job: HumanInterviewReminderJob, now: Date) {
  const rounds = await loadHumanInterviewReminderRounds(job, now);
  const targets = new Map<string, Target>();
  for (const reminder of rounds) {
    const recipients = await loadHumanInterviewReminderRecipients(reminder);
    for (const recipient of recipients) {
      const existing = targets.get(recipient.key);
      targets.set(recipient.key, {
        recipient: existing
          ? mergeReminderRecipients([existing.recipient, recipient])[0]
          : recipient,
        reminders: [...(existing?.reminders ?? []), reminder],
      });
    }
  }
  return targets;
}

export async function runHumanInterviewReminders(
  job: HumanInterviewReminderJob,
  now: () => Date = () => new Date(),
  waitForSend: (chatId: string) => Promise<void> = () => Promise.resolve(),
) {
  if (!isTelegramBotConfigured()) {
    throw new Error("Telegram is not configured");
  }
  const result = { failed: 0, retry: false, sent: 0, skipped: 0, unbound: 0 };
  const audience = await loadAudience(job, now());
  const targets = [...audience.values()];
  // Bound DB/provider concurrency; re-read one audience per batch instead of per recipient.
  for (let index = 0; index < targets.length; index += 4) {
    const batch = targets.slice(index, index + 4);
    const claimed = await Promise.all(
      batch.map(async (target) => {
        const attemptId = await claimHumanInterviewReminder(
          target.reminders,
          target.recipient,
          now(),
        );
        if (attemptId && target.recipient.chatId) {
          await waitForSend(target.recipient.chatId);
        }
        return { ...target, attemptId };
      }),
    );
    const fresh = await loadAudience(job, now());
    const outcomes = await Promise.allSettled(
      claimed.map(async ({ recipient, attemptId }) => {
        if (!attemptId) {
          result[recipient.chatId ? "skipped" : "unbound"] += 1;
          return;
        }
        const current = fresh.get(recipient.key);
        const finish = (status: "sent" | "failed" | "skipped", errorCode?: string) =>
          finishHumanInterviewReminder({
            ...job,
            attemptId,
            errorCode,
            now: now(),
            recipientKey: recipient.key,
            status,
          });
        if (
          !current?.recipient.chatId ||
          current.recipient.chatId !== recipient.chatId ||
          current.reminders[0].scheduledAt.getTime() <= now().getTime()
        ) {
          await finish("skipped", "schedule_or_recipient_changed");
          result.skipped += 1;
          return;
        }
        try {
          await postTelegramDirectMessage(
            current.recipient.chatId,
            buildHumanInterviewReminderMessage(current.reminders, current.recipient),
          );
        } catch {
          await finish("failed", "telegram_delivery_failed");
          result.failed += 1;
          return;
        }
        await finish("sent");
        result.sent += 1;
      }),
    );
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
  }
  const current = await loadAudience(job, now());
  const preparedKeys = new Set(targets.map((target) => target.recipient.key));
  result.retry =
    [...current.keys()].some((key) => !preparedKeys.has(key)) ||
    (await hasRetryableHumanInterviewReminder(job.meetingId, job.revision, [...current.keys()]));
  if (!result.retry) {
    await completeHumanInterviewReminderSchedule(job);
  }
  return result;
}
