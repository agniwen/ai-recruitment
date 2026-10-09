import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioHumanInterviewMeetingReminderDelivery as delivery } from "@arc/db-schema/schema";
import type { HumanInterviewReminder } from "./human-interview-reminders";
import type { HumanInterviewReminderRecipient } from "./human-interview-reminder-recipients";

const RETRY_DELAY_MS = 60_000;
const CLAIM_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

export async function claimHumanInterviewReminder(
  reminders: HumanInterviewReminder[],
  recipient: HumanInterviewReminderRecipient,
  now: Date,
): Promise<string | null> {
  const [reminder] = reminders;
  const identity = {
    meetingId: reminder.meetingId,
    recipientKey: recipient.key,
    revision: reminder.revision,
    scheduledAt: reminder.scheduledAt,
  };
  const target = [delivery.meetingId, delivery.revision, delivery.recipientKey];
  if (!recipient.chatId) {
    await db
      .insert(delivery)
      .values({
        ...identity,
        errorCode: "telegram_not_bound",
        lastAttemptAt: now,
        roles: recipient.roles,
        roundIds: reminders.map((row) => row.roundId),
        status: "unbound",
      })
      .onConflictDoNothing();
    return null;
  }
  const attemptId = randomUUID();
  const values = {
    attemptId,
    chatId: recipient.chatId,
    errorCode: null,
    lastAttemptAt: now,
    roles: recipient.roles,
    roundIds: reminders.map((row) => row.roundId),
    status: "sending" as const,
  };
  const [claimed] = await db
    .insert(delivery)
    .values({ ...identity, ...values, attempts: 1 })
    .onConflictDoUpdate({
      set: { ...values, attempts: sql`${delivery.attempts} + 1` },
      setWhere: and(
        lt(delivery.attempts, MAX_ATTEMPTS),
        or(
          and(
            inArray(delivery.status, ["failed", "skipped"]),
            lte(delivery.lastAttemptAt, new Date(now.getTime() - RETRY_DELAY_MS)),
          ),
          and(
            eq(delivery.status, "sending"),
            lte(delivery.lastAttemptAt, new Date(now.getTime() - CLAIM_TIMEOUT_MS)),
          ),
        ),
      ),
      target,
    })
    .returning({ attemptId: delivery.attemptId });
  return claimed?.attemptId ?? null;
}

export async function finishHumanInterviewReminder(input: {
  attemptId: string;
  errorCode?: string;
  now: Date;
  recipientKey: string;
  meetingId: string;
  revision: number;
  status: "sent" | "failed" | "skipped";
}) {
  await db
    .update(delivery)
    .set({
      errorCode: input.errorCode ?? null,
      sentAt: input.status === "sent" ? input.now : null,
      status: input.status,
    })
    .where(
      and(
        eq(delivery.meetingId, input.meetingId),
        eq(delivery.revision, input.revision),
        eq(delivery.recipientKey, input.recipientKey),
        eq(delivery.attemptId, input.attemptId),
        eq(delivery.status, "sending"),
      ),
    );
}

export async function hasRetryableHumanInterviewReminder(
  meetingId: string,
  revision: number,
  recipientKeys: string[],
) {
  if (!recipientKeys.length) {
    return false;
  }
  const rows = await db
    .select({ key: delivery.recipientKey })
    .from(delivery)
    .where(
      and(
        eq(delivery.meetingId, meetingId),
        eq(delivery.revision, revision),
        inArray(delivery.recipientKey, recipientKeys),
        or(
          eq(delivery.status, "unbound"),
          and(
            lt(delivery.attempts, MAX_ATTEMPTS),
            inArray(delivery.status, ["failed", "sending", "skipped"]),
          ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
