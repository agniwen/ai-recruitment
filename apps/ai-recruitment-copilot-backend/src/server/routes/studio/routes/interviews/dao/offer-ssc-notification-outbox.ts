import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  studioInterview,
  studioOfferDraft,
  studioOfferSscNotificationOutbox as outbox,
  sscTelegramIdentity,
  user,
} from "@arc/db-schema/schema";
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

function claimableNotifications() {
  return or(
    and(eq(outbox.status, "pending"), lte(outbox.availableAt, sql`CURRENT_TIMESTAMP`)),
    and(eq(outbox.status, "processing"), lte(outbox.leaseUntil, sql`CURRENT_TIMESTAMP`)),
  );
}

async function claimNotification(notificationId?: string) {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(outbox)
      .where(
        and(claimableNotifications(), notificationId ? eq(outbox.id, notificationId) : undefined),
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

function currentPendingOffer() {
  const newer = alias(studioOfferDraft, "ssc_notification_newer_offer");
  return exists(
    db
      .select({ id: studioOfferDraft.id })
      .from(studioOfferDraft)
      .innerJoin(
        studioInterview,
        and(
          eq(studioInterview.id, studioOfferDraft.interviewRecordId),
          eq(studioInterview.organizationId, studioOfferDraft.organizationId),
        ),
      )
      .where(
        and(
          eq(studioOfferDraft.id, outbox.draftId),
          eq(studioOfferDraft.organizationId, outbox.organizationId),
          eq(studioOfferDraft.interviewRecordId, outbox.interviewRecordId),
          eq(studioOfferDraft.sscRevision, outbox.revision),
          eq(studioOfferDraft.status, "draft"),
          eq(studioOfferDraft.sscConfirmationStatus, "pending"),
          ne(studioInterview.pipelineStage, "closed"),
          or(
            isNull(studioOfferDraft.expiresAt),
            sql`EXTRACT(EPOCH FROM ${studioOfferDraft.expiresAt}) > EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)`,
          ),
          notExists(
            db
              .select({ id: newer.id })
              .from(newer)
              .where(
                and(
                  eq(newer.organizationId, studioOfferDraft.organizationId),
                  eq(newer.interviewRecordId, studioOfferDraft.interviewRecordId),
                  gt(newer.version, studioOfferDraft.version),
                ),
              ),
          ),
        ),
      ),
  );
}

function completedWithoutRecipients() {
  return and(
    eq(outbox.event, "pending"),
    eq(outbox.status, "completed"),
    isNull(outbox.lastError),
    sql`${outbox.recipientUserIds} = '[]'::jsonb`,
    sql`${outbox.sentUserIds} = '[]'::jsonb`,
    currentPendingOffer(),
  );
}

async function recoverEmptyNotifications() {
  // Older releases acknowledged an empty recipient list. Reopen only live,
  // never-delivered pending Offers; every actual recipient is resolved again.
  const candidates = await db
    .select({ id: outbox.id })
    .from(outbox)
    .where(completedWithoutRecipients())
    .orderBy(asc(outbox.createdAt))
    .limit(20);
  if (candidates.length === 0) {
    return;
  }
  await db
    .update(outbox)
    .set({
      attempts: 0,
      availableAt: sql`CURRENT_TIMESTAMP`,
      completedAt: null,
      lastError: "ssc_recipient_unavailable",
      leaseToken: null,
      leaseUntil: null,
      recipientUserIds: null,
      status: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(
          outbox.id,
          candidates.map((candidate) => candidate.id),
        ),
        completedWithoutRecipients(),
      ),
    );
}

async function waitForRecipient(job: ClaimedNotification) {
  const updated = await db
    .update(outbox)
    .set({
      // Waiting for configuration is not a failed Telegram delivery attempt.
      attempts: Math.max(0, job.attempts - 1),
      availableAt: sql`CURRENT_TIMESTAMP + INTERVAL '60 seconds'`,
      completedAt: null,
      lastError: "ssc_recipient_unavailable",
      leaseToken: null,
      leaseUntil: null,
      recipientUserIds: null,
      status: "pending",
      updatedAt: new Date(),
    })
    .where(and(ownsLease(job), currentPendingOffer()))
    .returning({ id: outbox.id });
  return updated.length > 0;
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

async function upgradePendingRecipientKeys(job: ClaimedNotification) {
  if (job.event !== "pending" || job.recipientUserIds === null) {
    return job;
  }
  const ids = [...new Set([...job.recipientUserIds, ...job.sentUserIds])].filter(
    (id) => !id.startsWith("telegram:"),
  );
  if (ids.length === 0) {
    return job;
  }
  // Compatibility for persisted delivery snapshots only. These accounts never
  // select or authorize the new notification audience.
  const profiles = await db
    .select({
      chatId: sql<string | null>`coalesce(${sscTelegramIdentity.chatId}, ${user.telegramChatId})`,
      id: user.id,
    })
    .from(user)
    .leftJoin(sscTelegramIdentity, eq(sscTelegramIdentity.userId, user.id))
    .where(inArray(user.id, ids));
  const keys = new Map(
    profiles.flatMap((profile) =>
      profile.chatId && /^[1-9]\d*$/u.test(profile.chatId)
        ? [[profile.id, `telegram:${profile.chatId}`] as const]
        : [],
    ),
  );
  if (keys.size === 0) {
    return job;
  }
  const progress = {
    recipientUserIds: [...new Set(job.recipientUserIds.map((id) => keys.get(id) ?? id))],
    sentUserIds: [...new Set(job.sentUserIds.map((id) => keys.get(id) ?? id))],
  };
  await saveProgress(job, progress);
  return { ...job, ...progress };
}

async function deliverRecipients(
  claimedJob: ClaimedNotification,
  resolveTargets: ResolveTargets,
  sendMessage: SendMessage,
  lease: ReturnType<typeof maintainLease>,
) {
  const job = await upgradePendingRecipientKeys(claimedJob);
  let recipientIds = job.recipientUserIds;
  if (recipientIds === null) {
    const targets = await resolveTargets(job);
    if (
      targets.length === 0 &&
      job.event === "pending" &&
      job.sentUserIds.length === 0 &&
      (await waitForRecipient(job))
    ) {
      return "waiting";
    }
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
  if (
    !failed &&
    job.lastError !== "notification_delivery_failed" &&
    sentUserIds.length === 0 &&
    job.event === "pending" &&
    (await waitForRecipient(job))
  ) {
    return "waiting";
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
    const result = await deliverRecipients(job, resolveTargets, sendMessage, lease);
    if (result === "waiting") {
      return;
    }
    failed = result;
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

async function findNotificationForTestChat(testChat: string, resolveTargets: ResolveTargets) {
  let cursor: { id: string; availableAt: string; createdAt: string } | undefined;
  while (true) {
    const candidates = await db
      .select({
        // Preserve PostgreSQL microseconds; JS Date cursors can repeat a page.
        cursorAvailableAt: sql<string>`${outbox.availableAt}::text`,
        cursorCreatedAt: sql<string>`${outbox.createdAt}::text`,
        draftId: outbox.draftId,
        event: outbox.event,
        id: outbox.id,
        interviewRecordId: outbox.interviewRecordId,
        organizationId: outbox.organizationId,
        revision: outbox.revision,
      })
      .from(outbox)
      .where(
        and(
          claimableNotifications(),
          eq(outbox.event, "pending"),
          cursor
            ? sql`(${outbox.availableAt}, ${outbox.createdAt}, ${outbox.id}) > (${cursor.availableAt}::timestamptz, ${cursor.createdAt}::timestamptz, ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(asc(outbox.availableAt), asc(outbox.createdAt), asc(outbox.id))
      .limit(100);
    for (const candidate of candidates) {
      const targets = await resolveTargets(candidate);
      if (targets.length > 0 && targets.every((target) => target.chatId === testChat)) {
        return candidate.id;
      }
    }
    const last = candidates.at(-1);
    if (candidates.length < 100 || !last) {
      return;
    }
    cursor = { availableAt: last.cursorAvailableAt, createdAt: last.cursorCreatedAt, id: last.id };
  }
}

export async function dispatchOfferSscNotifications(): Promise<number> {
  const { isTelegramBotConfigured, postTelegramDirectMessage } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot");
  if (!isTelegramBotConfigured()) {
    return 0;
  }
  const { getOfferSscNotificationTargets } = await import("../utils/offer-ssc-notification");
  const configuredChat = process.env.OFFER_SSC_NOTIFICATION_TEST_CHAT_ID;
  const testChat = configuredChat?.trim();
  if (configuredChat !== undefined && !/^[1-9]\d*$/u.test(testChat ?? "")) {
    throw new Error("Invalid OFFER_SSC_NOTIFICATION_TEST_CHAT_ID");
  }
  if (!testChat) {
    await recoverEmptyNotifications();
  }
  const resolveTargets: ResolveTargets = async (input) => {
    const targets = await getOfferSscNotificationTargets(input);
    if (
      testChat &&
      (input.event !== "pending" || targets.some((target) => target.chatId !== testChat))
    ) {
      throw new Error("Notification is outside the local test recipient scope");
    }
    return targets;
  };
  const sendMessage: SendMessage = async (chatId, message) => {
    if (testChat && chatId !== testChat) {
      throw new Error("Notification recipient changed during local testing");
    }
    await postTelegramDirectMessage(chatId, message);
  };
  let processed = 0;
  while (processed < 20 && isTelegramBotConfigured()) {
    let notificationId: string | undefined;
    if (testChat) {
      notificationId = await findNotificationForTestChat(testChat, getOfferSscNotificationTargets);
      if (!notificationId) {
        break;
      }
    }
    const claim = await claimNotification(notificationId);
    if (!claim) {
      break;
    }
    processed += 1;
    if (claim.job) {
      await deliverNotification(claim.job, resolveTargets, sendMessage);
    }
  }
  return processed;
}

export function listenForOfferSscNotifications(wake: () => void) {
  return db.$client.listen(NOTIFY_CHANNEL, wake, wake);
}
