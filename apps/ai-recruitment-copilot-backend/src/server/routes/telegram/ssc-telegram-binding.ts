import { eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { sscTelegramIdentity } from "@arc/db-schema/schema";
import { normalizeTelegramUsername } from "./utils/identity";

/** Call only after verifying /start and an unambiguous live SSC ledger identity. */
export async function pinSscTelegramIdentity(input: {
  userId: string;
  chatId: string;
  username: string;
}): Promise<boolean> {
  const username = normalizeTelegramUsername(input.username);
  if (
    !input.userId.trim() ||
    !/^[1-9]\d*$/u.test(input.chatId) ||
    !username ||
    !/^[a-zA-Z0-9_]{5,32}$/u.test(username)
  ) {
    return false;
  }
  // Never rebind automatically: username transfers must not transfer approval access.
  // A future explicit administrator rebind flow must remove/reset this pin separately.
  await db
    .insert(sscTelegramIdentity)
    .values({
      chatId: input.chatId,
      userId: input.userId,
      username,
    })
    .onConflictDoNothing();
  const [pinned] = await db
    .select({
      chatId: sscTelegramIdentity.chatId,
      username: sscTelegramIdentity.username,
    })
    .from(sscTelegramIdentity)
    .where(eq(sscTelegramIdentity.userId, input.userId))
    .limit(1);
  return pinned?.chatId === input.chatId && pinned.username === username;
}
