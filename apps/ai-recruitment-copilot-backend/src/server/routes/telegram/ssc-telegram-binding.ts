import { eq, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { sscTelegramIdentity } from "@arc/db-schema/schema";
import { normalizeTelegramUsername } from "./utils/identity";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Call only after verifying /start and an unambiguous live SSC ledger identity. */
export async function pinSscTelegramIdentity(
  input: {
    userId: string;
    chatId: string;
    username: string;
  },
  transaction?: Transaction,
): Promise<boolean> {
  const username = normalizeTelegramUsername(input.username);
  if (
    !input.userId.trim() ||
    !/^[1-9]\d*$/u.test(input.chatId) ||
    !username ||
    !/^[a-zA-Z0-9_]{5,32}$/u.test(username)
  ) {
    return false;
  }
  const pin = async (tx: Transaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ssc-telegram:${username}`}, 0))`,
    );
    const existing = await tx
      .select()
      .from(sscTelegramIdentity)
      .where(
        or(
          eq(sscTelegramIdentity.userId, input.userId),
          eq(sscTelegramIdentity.chatId, input.chatId),
          eq(sscTelegramIdentity.username, username),
        ),
      );
    if (
      existing.some(
        (row) =>
          row.userId !== input.userId || row.chatId !== input.chatId || row.username !== username,
      )
    ) {
      return false;
    }
    await tx
      .insert(sscTelegramIdentity)
      .values({
        chatId: input.chatId,
        userId: input.userId,
        username,
      })
      .onConflictDoNothing();
    const [pinned] = await tx
      .select({
        chatId: sscTelegramIdentity.chatId,
        username: sscTelegramIdentity.username,
      })
      .from(sscTelegramIdentity)
      .where(eq(sscTelegramIdentity.userId, input.userId))
      .limit(1);
    return pinned?.chatId === input.chatId && pinned.username === username;
  };
  return await (transaction ? pin(transaction) : db.transaction(pin));
}
