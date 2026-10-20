import { eq, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  sscTelegramIdentity,
  telegramRecipientBinding,
  telegramRequesterBinding,
  user,
} from "@arc/db-schema/schema";
import { resolveExternalInterviewerBindings } from "../studio/routes/interviews/dao/external-interviewers";
import { normalizeTelegramUsername } from "./utils/identity";

/** Reuse verified legacy bindings without overwriting a current follower or a rename tombstone. */
export async function promoteLegacySscTelegramBindings(input: {
  organizationId: string;
  usernames: string[];
  chatId?: string;
}): Promise<void> {
  const usernames = [
    ...new Set(
      input.usernames
        .map(normalizeTelegramUsername)
        .filter((username): username is string =>
          Boolean(username && /^[a-zA-Z0-9_]{5,32}$/u.test(username)),
        ),
    ),
  ];
  if (!usernames.length) {
    return;
  }
  const candidates = await resolveExternalInterviewerBindings(
    input.organizationId,
    usernames.map((username) => ({ name: username, telegram: username })),
  );
  for (const candidate of candidates) {
    const username = normalizeTelegramUsername(candidate.telegram);
    const { chatId } = candidate;
    if (
      !username ||
      !chatId ||
      !/^[1-9]\d*$/u.test(chatId) ||
      (input.chatId && input.chatId !== chatId)
    ) {
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ssc-telegram:${username}`}, 0))`,
      );
      const current = await tx
        .select()
        .from(telegramRecipientBinding)
        .where(
          or(
            eq(telegramRecipientBinding.username, username),
            eq(telegramRecipientBinding.chatId, chatId),
          ),
        );
      // A row for this numeric chat with a null/different handle records a later
      // /start or username transfer. Legacy records must never revive that handle.
      if (current.length) {
        return;
      }
      const requesters = await tx
        .select()
        .from(telegramRequesterBinding)
        .where(eq(telegramRequesterBinding.username, username));
      const profiles = await tx
        .select()
        .from(user)
        .where(
          or(
            eq(user.telegramChatId, chatId),
            sql`lower(btrim(${user.telegramBoundUsername})) = ${username}`,
            sql`lower(btrim(trim(leading '@' from btrim(${user.telegram})))) = ${username}`,
          ),
        );
      const verified =
        requesters.some(
          (row) => row.organizationId === input.organizationId && row.chatId === chatId,
        ) ||
        profiles.some(
          (profile) =>
            normalizeTelegramUsername(profile.telegram) === username &&
            normalizeTelegramUsername(profile.telegramBoundUsername) === username &&
            profile.telegramChatId === chatId,
        );
      if (
        !verified ||
        requesters.some((row) => row.chatId !== chatId) ||
        profiles.length > 1 ||
        profiles.some(
          (profile) =>
            profile.banned ||
            (profile.telegram?.trim() &&
              normalizeTelegramUsername(profile.telegram) !== username) ||
            (profile.telegramBoundUsername &&
              normalizeTelegramUsername(profile.telegramBoundUsername) !== username) ||
            (profile.telegramChatId && profile.telegramChatId !== chatId),
        )
      ) {
        return;
      }
      const pins = await tx
        .select()
        .from(sscTelegramIdentity)
        .where(
          or(eq(sscTelegramIdentity.chatId, chatId), eq(sscTelegramIdentity.username, username)),
        );
      if (
        pins.length > 1 ||
        pins.some(
          (pin) =>
            pin.chatId !== chatId ||
            pin.username !== username ||
            (profiles.length === 1 && pin.userId !== profiles[0].id),
        )
      ) {
        return;
      }
      // A simultaneous /start may insert a newer mapping without using this
      // provisioning lock. Never overwrite either of its unique identity keys.
      await tx.insert(telegramRecipientBinding).values({ chatId, username }).onConflictDoNothing();
    });
  }
}
