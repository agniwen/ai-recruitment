import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";

export const TELEGRAM_RECRUITER_CONTACT_TTL_MS = 24 * 60 * 60_000;

const pendingSchema = z.object({
  candidatePrivateTelegram: z.string().min(1).max(120).nullable(),
  chatId: z.string().regex(/^[1-9]\d*$/u),
  draftId: z.uuid(),
  expiresAt: z.number().finite(),
  interviewRecordId: z.string().min(1),
  organizationId: z.string().min(1),
  originMessageId: z.number().int().positive().optional(),
  phase: z.enum(["opening", "input", "review", "submitting"]),
  promptMessageId: z.number().int().positive().optional(),
  reviewMessageId: z.number().int().positive().optional(),
  revision: z.number().int().positive(),
  telegramUsername: z.string().min(1),
});

export type TelegramOfferRecruiterPending = z.infer<typeof pendingSchema>;
interface StatefulThread {
  readonly state: Promise<unknown>;
  setState(state: Record<string, unknown>): Promise<void>;
}

export async function withTelegramOfferRecruiterState<T>(
  thread: StatefulThread,
  chatId: string,
  update: (pending: Record<string, TelegramOfferRecruiterPending>) => T,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Completion and recruiter handlers update the same durable thread document.
    // Share its lock and preserve unrelated fields so neither workflow erases the other.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-offer-completion:${chatId}`}, 0))`,
    );
    const state = await thread.state;
    const document = state && typeof state === "object" ? state : {};
    const stored = "offerRecruiterContacts" in document ? document.offerRecruiterContacts : null;
    const pending: Record<string, TelegramOfferRecruiterPending> = {};
    if (stored && typeof stored === "object") {
      for (const [token, value] of Object.entries(stored)) {
        const parsed = pendingSchema.safeParse(value);
        if (/^[0-9a-f]{32}$/u.test(token) && parsed.success && parsed.data.expiresAt > Date.now()) {
          pending[token] = parsed.data;
        }
      }
    }
    const result = update(pending);
    await thread.setState({ ...document, offerRecruiterContacts: pending });
    return result;
  });
}
