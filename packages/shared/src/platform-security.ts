import { z } from "zod";

export const MFA_VALIDITY_SECONDS = 15 * 60;
export const PLATFORM_MFA_PATH = "/platform/verify";
export function platformMfaReturnTo(value: unknown) {
  const fallback = "/platform/organizations";
  if (typeof value !== "string" || !value.startsWith("/")) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(value, "https://platform.invalid");
  } catch {
    return fallback;
  }
  if (
    url.origin !== "https://platform.invalid" ||
    !(url.pathname === "/platform" || url.pathname.startsWith("/platform/")) ||
    url.pathname === PLATFORM_MFA_PATH ||
    url.pathname.startsWith(`${PLATFORM_MFA_PATH}/`)
  ) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function platformMfaHref(returnTo: unknown) {
  return `${PLATFORM_MFA_PATH}?returnTo=${encodeURIComponent(platformMfaReturnTo(returnTo))}`;
}
export const mfaActivitySchema = z.object({ activeAt: z.number().int().nonnegative() });
export const revealIpSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["telemetry", "entry-use", "media"]),
  meetingId: z.string().min(1).max(200),
});
export type IpReference = z.infer<typeof revealIpSchema>;
export const mfaCodeSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().regex(/^[a-f0-9]{32}$/i), method: z.literal("recovery") }),
]);
export type MfaCode = z.infer<typeof mfaCodeSchema>;
export const mfaReplacementCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export interface MfaStatus {
  enrolled: boolean;
  expiresAt: string | null;
}
