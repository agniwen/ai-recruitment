import { randomInt } from "node:crypto";
import { z } from "zod";

const webhookInfoSchema = z.object({
  allowed_updates: z.array(z.string()).optional(),
  has_custom_certificate: z.boolean(),
  max_connections: z.number().int().min(1).max(100).optional(),
  url: z.string(),
});

async function telegramRequest(token: string, method: string, body: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error("Telegram webhook request failed");
  }
  const result = z
    .object({ ok: z.literal(true), result: z.unknown() })
    .parse(await response.json());
  return result.result;
}

async function probe(url: string, secret: string) {
  const response = await fetch(url, {
    body: JSON.stringify({ update_id: 9_000_000_000_000 + randomInt(1_000_000_000) }),
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  return response.status;
}

function unavailable(reason: string) {
  console.warn(`[offer-ssc-webhook] ${reason}; Offer notifications remain pending`);
  return false;
}

async function authenticateCallback(url: string, secret: string) {
  const positive = await probe(url, secret);
  const negative = await probe(url, `invalid_offer_probe_${randomInt(1_000_000_000)}`);
  return positive >= 200 && positive < 300 && [401, 403].includes(negative);
}

async function registerWebhook(
  token: string,
  secret: string,
  url: string,
  current: z.infer<typeof webhookInfoSchema>,
) {
  const allowed = current.allowed_updates;
  // The default event subscription also applies when no webhook is registered.
  const updates = allowed?.length ? [...new Set([...allowed, "message", "callback_query"])] : [];
  // Telegram does not expose its saved secret. Reassert this deployment's
  // authenticated secret after releases, including when filters already match.
  const registered = await telegramRequest(token, "setWebhook", {
    allowed_updates: updates,
    drop_pending_updates: false,
    ...(current.max_connections ? { max_connections: current.max_connections } : {}),
    secret_token: secret,
    url,
  });
  if (registered !== true) {
    return unavailable("registration_not_acknowledged");
  }
  const verified = webhookInfoSchema.parse(await telegramRequest(token, "getWebhookInfo", {}));
  const filterMatches =
    updates.length === 0
      ? !verified.allowed_updates?.length
      : updates.every((update) => verified.allowed_updates?.includes(update));
  if (verified.url !== url || !filterMatches) {
    return unavailable("registration_readback_failed");
  }
  console.info("[offer-ssc-webhook] production message and callback subscriptions verified");
  return true;
}

/** Manages only this deployment's existing webhook, never another environment's bot. */
export async function ensureTelegramOfferWebhook(): Promise<boolean> {
  // Explicit local tests manage their shared-bot relay separately.
  if (process.env.OFFER_SSC_NOTIFICATION_TEST_CHAT_ID !== undefined) {
    return true;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  if (!token || !secret || !base) {
    return unavailable("missing_configuration");
  }
  try {
    const origin = new URL(base);
    if (origin.protocol !== "https:" || origin.username || origin.password) {
      return unavailable("invalid_public_url");
    }
    const url = new URL("/api/telegram/webhook", origin.origin).toString();
    const current = webhookInfoSchema.parse(await telegramRequest(token, "getWebhookInfo", {}));
    if (current.url && current.url !== url) {
      return unavailable("different_environment");
    }
    if (current.has_custom_certificate) {
      return unavailable("custom_certificate_requires_manual_setup");
    }
    if (!(await authenticateCallback(url, secret))) {
      return unavailable("callback_authentication_failed");
    }
    const latest = webhookInfoSchema.parse(await telegramRequest(token, "getWebhookInfo", {}));
    if (JSON.stringify(latest) !== JSON.stringify(current)) {
      return unavailable("webhook_changed_during_initialization");
    }
    return await registerWebhook(token, secret, url, current);
  } catch {
    // Transport errors can contain the Bot Token in their URL; never log them.
    return unavailable("initialization_failed");
  }
}
