import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioOfferSscNotificationOutbox as outbox } from "@arc/db-schema/schema";
import type * as TelegramBot from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import type { OfferSscNotificationTarget } from "../utils/offer-ssc-notification";

export interface OfferSscNotificationInput {
  draftId: string;
  organizationId: string;
  interviewRecordId: string;
  revision: number;
  event: "pending" | "received" | "completed";
}

type OfferSscTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ClaimedNotification = typeof outbox.$inferSelect & { leaseToken: string };
type ResolveTargets = (input: OfferSscNotificationInput) => Promise<OfferSscNotificationTarget[]>;
type SendMessage = typeof TelegramBot.postTelegramDirectMessage;
const NOTIFY_CHANNEL = "offer_ssc_notification_changed";
const MAX_ATTEMPTS = 5;

export async function enqueueOfferSscNotification(
  tx: OfferSscTransaction,
  input: OfferSscNotificationInput,
): Promise<void> {
  const inserted = await tx
    .insert(outbox)
    .values({ ...input, id: randomUUID() })
    .onConflictDoNothing({ target: [outbox.draftId, outbox.revision, outbox.event] })
    .returning({ id: outbox.id });
  if (inserted.length > 0) {
    // PostgreSQL delivers this wakeup only after the business transaction commits.
    await tx.execute(sql`SELECT pg_notify(${NOTIFY_CHANNEL}, '')`);
  }
}

async function claimNotification() {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(outbox)
      .where(
        or(
          and(eq(outbox.status, "pending"), lte(outbox.availableAt, sql`CURRENT_TIMESTAMP`)),
          and(eq(outbox.status, "processing"), lte(outbox.leaseUntil, sql`CURRENT_TIMESTAMP`)),
        ),
      )
      .orderBy(asc(outbox.availableAt), asc(outbox.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) {
      return null;
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await tx
        .update(outbox)
        .set({
          completedAt: new Date(),
          lastError: "attempts_exhausted",
          leaseToken: null,
          leaseUntil: null,
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(outbox.id, row.id));
      return { job: null };
    }
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(outbox)
      .set({
        attempts: row.attempts + 1,
        leaseToken,
        leaseUntil: sql`CURRENT_TIMESTAMP + INTERVAL '60 seconds'`,
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(outbox.id, row.id))
      .returning();
    return { job: { ...claimed, leaseToken } };
  });
}

class NotificationLeaseLostError extends Error {
  override name = "NotificationLeaseLostError";
}

function ownsLease(job: ClaimedNotification) {
  return and(
    eq(outbox.id, job.id),
    eq(outbox.status, "processing"),
    eq(outbox.leaseToken, job.leaseToken),
    gt(outbox.leaseUntil, sql`CURRENT_TIMESTAMP`),
  );
}

async function renewLease(job: ClaimedNotification) {
  const updated = await db
    .update(outbox)
    .set({ leaseUntil: sql`CURRENT_TIMESTAMP + INTERVAL '60 seconds'`, updatedAt: new Date() })
    .where(ownsLease(job))
    .returning({ id: outbox.id });
  if (updated.length === 0) {
    throw new NotificationLeaseLostError();
  }
}

function maintainLease(job: ClaimedNotification) {
  let lost = false;
  let pending: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (pending) {
      return;
    }
    pending = (async () => {
      try {
        await renewLease(job);
      } catch {
        lost = true;
      } finally {
        pending = null;
      }
    })();
  }, 20_000);
  timer.unref();
  return {
    assertOwned() {
      if (lost) {
        throw new NotificationLeaseLostError();
      }
    },
    async stop() {
      clearInterval(timer);
      await pending;
    },
  };
}

async function saveProgress(
  job: ClaimedNotification,
  progress: { recipientUserIds?: string[]; sentUserIds?: string[] },
) {
  const updated = await db
    .update(outbox)
    .set({ ...progress, updatedAt: new Date() })
    .where(ownsLease(job))
    .returning({ id: outbox.id });
  if (updated.length === 0) {
    throw new NotificationLeaseLostError();
  }
}

async function deliverRecipients(
  job: ClaimedNotification,
  resolveTargets: ResolveTargets,
  sendMessage: SendMessage,
  lease: ReturnType<typeof maintainLease>,
) {
  let recipientIds = job.recipientUserIds;
  if (recipientIds === null) {
    const targets = await resolveTargets(job);
    recipientIds = [...new Set(targets.map((target) => target.userId))];
    await saveProgress(job, { recipientUserIds: recipientIds });
  }
  const sentUserIds = [...job.sentUserIds];
  let failed = false;
  for (const userId of recipientIds) {
    lease.assertOwned();
    if (sentUserIds.includes(userId)) {
      continue;
    }
    const targets = await resolveTargets(job);
    const target = targets.find((candidate) => candidate.userId === userId);
    if (!target) {
      continue;
    }
    await renewLease(job);
    try {
      await sendMessage(target.chatId, target.message);
    } catch {
      failed = true;
      continue;
    }
    sentUserIds.push(userId);
    await saveProgress(job, { sentUserIds });
  }
  return failed;
}

async function finishNotification(job: ClaimedNotification, failed: boolean) {
  const retry = failed && job.attempts < MAX_ATTEMPTS;
  const delay = Math.min(600_000, 10_000 * 3 ** (job.attempts - 1));
  let status: "pending" | "failed" | "completed" = "completed";
  if (retry) {
    status = "pending";
  } else if (failed) {
    status = "failed";
  }
  const updated = await db
    .update(outbox)
    .set({
      availableAt: retry ? new Date(Date.now() + delay) : job.availableAt,
      completedAt: retry ? null : new Date(),
      lastError: failed ? "notification_delivery_failed" : null,
      leaseToken: null,
      leaseUntil: null,
      status,
      updatedAt: new Date(),
    })
    .where(ownsLease(job))
    .returning({ id: outbox.id });
  if (updated.length === 0) {
    throw new NotificationLeaseLostError();
  }
}

async function deliverNotification(
  job: ClaimedNotification,
  resolveTargets: ResolveTargets,
  sendMessage: SendMessage,
) {
  const lease = maintainLease(job);
  let failed = false;
  try {
    failed = await deliverRecipients(job, resolveTargets, sendMessage, lease);
  } catch (error) {
    if (error instanceof NotificationLeaseLostError) {
      return;
    }
    failed = true;
  } finally {
    await lease.stop();
  }
  try {
    lease.assertOwned();
    await finishNotification(job, failed);
  } catch (error) {
    if (!(error instanceof NotificationLeaseLostError)) {
      throw error;
    }
  }
}

export async function dispatchOfferSscNotifications(): Promise<number> {
  const { isTelegramBotConfigured, postTelegramDirectMessage } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot");
  if (!isTelegramBotConfigured()) {
    return 0;
  }
  const { getOfferSscNotificationTargets } = await import("../utils/offer-ssc-notification");
  let processed = 0;
  while (processed < 20 && isTelegramBotConfigured()) {
    const claim = await claimNotification();
    if (!claim) {
      break;
    }
    processed += 1;
    if (claim.job) {
      await deliverNotification(
        claim.job,
        getOfferSscNotificationTargets,
        postTelegramDirectMessage,
      );
    }
  }
  return processed;
}

export function listenForOfferSscNotifications(wake: () => void) {
  return db.$client.listen(NOTIFY_CHANNEL, wake, wake);
}
