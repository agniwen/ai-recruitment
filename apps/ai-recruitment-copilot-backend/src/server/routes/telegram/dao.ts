import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { jobDescription, telegramRequesterBinding, user } from "@arc/db-schema/schema";
import { extractRequesterTelegramUsernames, normalizeTelegramUsername } from "./utils/identity";

export type TelegramBindingResult =
  | { kind: "ambiguous" }
  | { kind: "bound"; userName: string }
  | { kind: "requester_bound"; memberName: string | null; memberAmbiguous: boolean }
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
  const requesters = await db
    .selectDistinct({
      organizationId: jobDescription.organizationId,
      requester: jobDescription.requester,
    })
    .from(jobDescription)
    .where(isNotNull(jobDescription.requester));
  const organizationIds = [
    ...new Set(
      requesters
        .filter((row) => extractRequesterTelegramUsernames(row.requester).includes(username))
        .map((row) => row.organizationId),
    ),
  ];
  const matched = matches.length === 1 ? matches[0] : undefined;

  if (matched || organizationIds.length > 0) {
    await db.transaction(async (tx) => {
      if (matched) {
        await tx
          .update(user)
          .set({
            telegramBoundUsername: username,
            telegramChatId: input.chatId,
            updatedAt: new Date(),
          })
          .where(eq(user.id, matched.id));
      }
      if (organizationIds.length > 0) {
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
  }
  if (organizationIds.length > 0) {
    return {
      kind: "requester_bound",
      memberAmbiguous: matches.length > 1,
      memberName: matched?.name ?? null,
    };
  }
  if (matched) {
    return { kind: "bound", userName: matched.name };
  }
  return { kind: matches.length > 1 ? "ambiguous" : "not_found" };
}
