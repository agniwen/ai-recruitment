import { z } from "zod";

/** Accept a public user handle, never a group invite or a bot deep link. */
export function normalizeCandidatePrivateTelegram(value: string): string | null {
  const input = value.trim();
  const username =
    /^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{5,32})\/?$/iu.exec(input)?.[1] ??
    /^@?([a-zA-Z0-9_]{5,32})$/u.exec(input)?.[1];
  return username ? `@${username}` : null;
}

export const candidatePrivateTelegramSchema = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    const normalized = normalizeCandidatePrivateTelegram(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "请填写有效的候选人私人 TG 用户名，例如 @candidate_name。",
      });
      return z.NEVER;
    }
    return normalized;
  });

export type OfferRecruiterConfirmationStatus = "pending" | "completed";
