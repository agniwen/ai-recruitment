import { MFA_VALIDITY_SECONDS } from "@arc/shared/platform-security";

export const ENROLLMENT_VALIDITY_MS = 10 * 60_000;
export const MFA_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-arc-admin-mfa" : "arc-admin-mfa";
export const MFA_COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: MFA_VALIDITY_SECONDS,
  path: "/",
  sameSite: "Strict",
  secure: process.env.NODE_ENV === "production",
} as const;

export function readMfaCookie(headers: Headers) {
  const value = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${MFA_COOKIE}=`))
    ?.slice(MFA_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function nextMfaFailure(
  state: { failedAttempts: number; failureWindowAt: Date | null },
  now: Date,
) {
  const inWindow =
    state.failureWindowAt && now.getTime() - state.failureWindowAt.getTime() < 5 * 60_000;
  const failedAttempts = inWindow ? state.failedAttempts + 1 : 1;
  return {
    failedAttempts,
    failureWindowAt: inWindow ? state.failureWindowAt : now,
    lockedUntil: failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null,
  };
}
