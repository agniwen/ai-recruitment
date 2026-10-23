import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { TELEGRAM_COMPLETION_TTL_MS } from "./offer-ssc-state";

export const TELEGRAM_PREBOARDING_TTL_MS = TELEGRAM_COMPLETION_TTL_MS;
const pendingSchema = z.object({
  chatId: z.string().min(1),
  draftId: z.uuid(),
  expiresAt: z.number().finite(),
  originMessageId: z.number().int().positive(),
  promptMessageId: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.enum(["pending", "saving"]),
  telegramUsername: z.string().min(1),
});
export type TelegramPreboardingPending = z.infer<typeof pendingSchema>;

interface StatefulThread {
  readonly state: Promise<unknown>;
  setState(state: Record<string, unknown>): Promise<void>;
}

export async function withTelegramPreboardingState<T>(
  thread: StatefulThread,
  chatId: string,
  update: (pending: Record<string, TelegramPreboardingPending>) => T,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Share the completion lock so a date reply cannot overwrite screenshot state.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-offer-completion:${chatId}`}, 0))`,
    );
    const state = await thread.state;
    const stored =
      state && typeof state === "object" && "offerPreboardingDates" in state
        ? state.offerPreboardingDates
        : null;
    const pending: Record<string, TelegramPreboardingPending> = {};
    if (stored && typeof stored === "object") {
      for (const [token, value] of Object.entries(stored)) {
        const parsed = pendingSchema.safeParse(value);
        if (/^[0-9a-f]{32}$/u.test(token) && parsed.success && parsed.data.expiresAt > Date.now()) {
          pending[token] = parsed.data;
        }
      }
    }
    const result = update(pending);
    await thread.setState({
      ...(state && typeof state === "object" ? state : {}),
      offerPreboardingDates: pending,
    });
    return result;
  });
}
