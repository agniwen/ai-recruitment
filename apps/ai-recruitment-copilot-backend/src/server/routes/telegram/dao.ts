import { eq, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { user } from "@arc/db-schema/schema";
import { normalizeTelegramUsername } from "./utils/identity";

export type TelegramBindingResult =
  | { kind: "ambiguous" }
  | { kind: "bound"; userName: string }
  | { kind: "missing_username" }
  | { kind: "not_found" };

export async function bindTelegramUser(input: {
  chatId: string;
  username: string | null | undefined;
}): Promise<TelegramBindingResult> {
  const username = normalizeTelegramUsername(input.username);
  if (!username) {
    return { kind: "missing_username" };
  }

  const matches = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(sql<string>`lower(trim(leading '@' from ${user.telegram}))`, username))
    .limit(2);
  if (matches.length === 0) {
    return { kind: "not_found" };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous" };
  }

  const [matched] = matches;
  if (!matched) {
    return { kind: "not_found" };
  }
  await db
    .update(user)
    .set({
      telegramBoundUsername: username,
      telegramChatId: input.chatId,
      updatedAt: new Date(),
    })
    .where(eq(user.id, matched.id));
  return { kind: "bound", userName: matched.name };
}
