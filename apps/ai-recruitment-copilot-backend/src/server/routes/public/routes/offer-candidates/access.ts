import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getRequiredEnv } from "@arc/ai-recruitment-copilot-backend/lib/server/env";

const PURPOSE = "offer-candidate-readonly:v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const identifier = z.string().trim().min(1).max(256);
const basePayloadSchema = z.object({
  candidateId: identifier,
  draftId: z.uuid(),
  exp: z.number().int().positive(),
  organizationId: identifier,
  purpose: z.literal(PURPOSE),
  revision: z.number().int().positive().max(2_147_483_647),
});

const telegramActorSchema = z.strictObject({
  telegramUserId: z.string().regex(/^[1-9]\d*$/u),
  username: z.string().regex(/^[a-zA-Z0-9_]{5,32}$/u),
});
const payloadSchema = z.union([
  basePayloadSchema.extend({ actorUserId: identifier }).strict(),
  basePayloadSchema.extend({ telegramActor: telegramActorSchema }).strict(),
]);

export type OfferCandidatePreviewAccess = z.infer<typeof payloadSchema>;

function signature(payload: string) {
  return createHmac("sha256", getRequiredEnv("BETTER_AUTH_SECRET"))
    .update(`${PURPOSE}:${payload}`)
    .digest("base64url");
}

export function buildOfferCandidatePreviewLink(
  input: ({ actorUserId: string } | { telegramActor: z.infer<typeof telegramActorSchema> }) & {
    organizationId: string;
    candidateId: string;
    draftId: string;
    revision: number;
  },
  now = Date.now(),
): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  if (!base) {
    return null;
  }
  const origin = new URL(base);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("Invalid application URL for Offer candidate preview");
  }
  const payload = payloadSchema.parse({ ...input, exp: now + TTL_MS, purpose: PURPOSE });
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return new URL(`/offer-candidate/${encoded}.${signature(encoded)}`, origin.origin).toString();
}

export function verifyOfferCandidatePreviewToken(
  token: string,
): OfferCandidatePreviewAccess | null {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(token)) {
    return null;
  }
  const [encoded, actualSignature] = token.split(".");
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded) {
    return null;
  }
  const expected = Buffer.from(signature(encoded));
  const actual = Buffer.from(actualSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const result = payloadSchema.safeParse(JSON.parse(decoded.toString("utf-8")));
    const now = Date.now();
    return result.success && result.data.exp > now && result.data.exp <= now + TTL_MS
      ? result.data
      : null;
  } catch {
    return null;
  }
}
