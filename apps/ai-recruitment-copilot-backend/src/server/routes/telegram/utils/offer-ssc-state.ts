import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";

export const MAX_TELEGRAM_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const TELEGRAM_COMPLETION_TTL_MS = 30 * 60_000;

const screenshotSchema = z.object({
  fileId: z.string().min(1).max(500),
  filename: z.string().min(1).max(255),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(MAX_TELEGRAM_SCREENSHOT_BYTES).optional(),
});

const pendingSchema = z.object({
  // Accept pending prompts issued before TG-only operations.
  actorUserId: z.string().min(1).optional(),
  chatId: z.string().min(1),
  draftId: z.uuid(),
  expiresAt: z.number().finite(),
  interviewRecordId: z.string().min(1),
  organizationId: z.string().min(1),
  originMessageId: z.number().int().positive().optional(),
  preboardingDate: z.iso.date().optional(),
  promptMessageId: z.number().int().positive(),
  revision: z.number().int().positive(),
  screenshot: screenshotSchema.optional(),
  status: z.enum(["pending", "completing"]),
  telegramUsername: z.string().min(1).optional(),
  uploadPromptMessageId: z.number().int().positive().optional(),
  uploadSelectionId: z.uuid().optional(),
});

const openingSchema = z.object({
  expiresAt: z.number().finite(),
  revision: z.number().int().positive(),
  token: z.string().regex(/^[0-9a-f]{32}$/u),
});

export type TelegramScreenshotReference = z.infer<typeof screenshotSchema>;
export type TelegramOfferCompletionPending = z.infer<typeof pendingSchema>;
type TelegramOfferCompletionOpening = z.infer<typeof openingSchema>;

interface StatefulThread {
  readonly state: Promise<unknown>;
  setState(state: Record<string, unknown>): Promise<void>;
}

function readCompletionOpenings(state: unknown) {
  const stored =
    state && typeof state === "object" && "offerSscCompletionOpenings" in state
      ? state.offerSscCompletionOpenings
      : null;
  const openings: Record<string, TelegramOfferCompletionOpening> = {};
  if (stored && typeof stored === "object") {
    for (const [draftId, value] of Object.entries(stored)) {
      const parsed = openingSchema.safeParse(value);
      if (
        z.uuid().safeParse(draftId).success &&
        parsed.success &&
        parsed.data.expiresAt > Date.now()
      ) {
        openings[draftId] = parsed.data;
      }
    }
  }
  return openings;
}

// Action callbacks and message handlers do not necessarily share an SDK lock.
// Hold this lock only while reading/claiming/writing durable conversation state.
export async function withTelegramOfferCompletionState<T>(
  thread: StatefulThread,
  chatId: string,
  update: (
    pending: Record<string, TelegramOfferCompletionPending>,
    openings: Record<string, TelegramOfferCompletionOpening>,
  ) => T,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-offer-completion:${chatId}`}, 0))`,
    );
    const state = await thread.state;
    const stored =
      state && typeof state === "object" && "offerSscCompletions" in state
        ? state.offerSscCompletions
        : null;
    const pending: Record<string, TelegramOfferCompletionPending> = {};
    if (stored && typeof stored === "object") {
      for (const [token, value] of Object.entries(stored)) {
        const parsed = pendingSchema.safeParse(value);
        if (/^[0-9a-f]{32}$/u.test(token) && parsed.success && parsed.data.expiresAt > Date.now()) {
          pending[token] = parsed.data;
        }
      }
    }
    const openings = readCompletionOpenings(state);
    const result = update(pending, openings);
    await thread.setState({
      ...(state && typeof state === "object" ? state : {}),
      offerSscCompletionOpenings: openings,
      offerSscCompletions: pending,
    });
    return result;
  });
}
