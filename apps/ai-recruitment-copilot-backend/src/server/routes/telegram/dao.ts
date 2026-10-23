import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  telegramRecipientBinding,
  telegramRequesterBinding,
  user,
} from "@arc/db-schema/schema";
import { extractRequesterTelegramUsernames, normalizeTelegramUsername } from "./utils/identity";
import { provisionSscTelegramFollower } from "./ssc-telegram-provisioning";

export type TelegramBindingResult = (
  | { kind: "bound"; userName: string }
  | { kind: "requester_bound"; memberName: string | null; memberAmbiguous: boolean }
  | { kind: "registered"; memberAmbiguous: boolean }
) & { sscProvisioningPending?: true };

/** Notification opt-in only; this lookup does not bind a user or authorize Offer actions. */
export async function isTelegramNotificationFollower(chatId: string): Promise<boolean> {
  if (!/^[1-9]\d*$/u.test(chatId)) {
    return false;
  }
  const followed = await db.query.telegramRecipientBinding.findFirst({
    columns: { chatId: true },
    where: { chatId },
  });
  return Boolean(followed);
}

export async function bindTelegramUser(input: {
  chatId: string;
  username: string | null | undefined;
}): Promise<TelegramBindingResult> {
  const username = normalizeTelegramUsername(input.username);
  const matches = username
    ? await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(eq(sql<string>`lower(trim(leading '@' from ${user.telegram}))`, username))
        .limit(2)
    : [];
  const requesters = username
    ? await db
        .selectDistinct({
          organizationId: jobDescription.organizationId,
          requester: jobDescription.requester,
        })
        .from(jobDescription)
        .where(isNotNull(jobDescription.requester))
    : [];
  const organizationIds = [
    ...new Set(
      requesters
        .filter((row) => extractRequesterTelegramUsernames(row.requester).includes(username ?? ""))
        .map((row) => row.organizationId),
    ),
  ];
  const matched = matches.length === 1 ? matches[0] : undefined;

  await db.transaction(async (tx) => {
    if (username) {
      // Keep followers when a username moves to a different Telegram account.
      await tx
        .update(telegramRecipientBinding)
        .set({ username: null })
        .where(
          and(
            eq(telegramRecipientBinding.username, username),
            ne(telegramRecipientBinding.chatId, input.chatId),
          ),
        );
    }
    await tx
      .insert(telegramRecipientBinding)
      .values({ chatId: input.chatId, username })
      .onConflictDoUpdate({
        set: { updatedAt: new Date(), username },
        target: telegramRecipientBinding.chatId,
      });
    if (matched && username) {
      await tx
        .update(user)
        .set({
          telegramBoundUsername: username,
          telegramChatId: input.chatId,
          updatedAt: new Date(),
        })
        .where(eq(user.id, matched.id));
    }
    if (organizationIds.length > 0 && username) {
      await tx
        .insert(telegramRequesterBinding)
        .values(
          organizationIds.map((organizationId) => ({
            chatId: input.chatId,
            organizationId,
            username,
          })),
        )
        .onConflictDoUpdate({
          set: { chatId: input.chatId, updatedAt: new Date() },
          target: [telegramRequesterBinding.organizationId, telegramRequesterBinding.username],
        });
    }
  });
  let ssc: Awaited<ReturnType<typeof provisionSscTelegramFollower>> = null;
  const sync: { sscProvisioningPending?: true } = {};
  if (username && matches.length <= 1) {
    try {
      ssc = await provisionSscTelegramFollower({ chatId: input.chatId, username });
    } catch {
      // The opt-in above has committed; the outbox will retry SSC provisioning.
      sync.sscProvisioningPending = true;
      console.error("[telegram-binding] ssc_provisioning_failed");
    }
  }
  if (organizationIds.length > 0) {
    return {
      ...sync,
      kind: "requester_bound",
      memberAmbiguous: matches.length > 1,
      memberName: matched?.name ?? null,
    };
  }
  if (matched) {
    return { ...sync, kind: "bound", userName: matched.name };
  }
  if (ssc) {
    return { kind: "bound", userName: ssc.name };
  }
  return { ...sync, kind: "registered", memberAmbiguous: matches.length > 1 };
}
