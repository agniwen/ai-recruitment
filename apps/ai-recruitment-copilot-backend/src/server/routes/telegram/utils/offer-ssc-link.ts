import { z } from "zod";

/** Public navigation only: the bot authorizes the actual sender on every request. */
export function buildTelegramOfferLink(draftId: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/u, "");
  if (
    !username ||
    !/^[a-zA-Z0-9_]{5,32}$/u.test(username) ||
    !z.uuid().safeParse(draftId).success
  ) {
    return null;
  }
  return `https://t.me/${username}?start=offer_${draftId}`;
}
