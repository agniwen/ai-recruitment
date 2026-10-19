import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { normalizeTelegramUsername } from "./utils/identity";
import { resolveLedgerTelegramOfferActor } from "./ssc-recipients";

/** Notification-only numeric recipients are deliberately not approval identities. */
export async function resolveBoundTelegramOfferActor(input: {
  telegramUserId: string;
  username?: string;
}): Promise<string | null> {
  const username = normalizeTelegramUsername(input.username);
  if (!username) {
    return null;
  }
  const users = await db.query.user.findMany({
    columns: {
      banned: true,
      id: true,
      telegram: true,
      telegramBoundUsername: true,
      telegramChatId: true,
    },
    limit: 2,
    where: { telegramChatId: input.telegramUserId },
  });
  if (users.length === 0) {
    return await resolveLedgerTelegramOfferActor({
      telegramUserId: input.telegramUserId,
      username,
    });
  }
  if (users.length !== 1) {
    return null;
  }
  const [user] = users;
  if (
    user.banned ||
    user.telegramChatId !== input.telegramUserId ||
    normalizeTelegramUsername(user.telegramBoundUsername) !== username ||
    normalizeTelegramUsername(user.telegram) !== username
  ) {
    return null;
  }
  return user.id;
}
