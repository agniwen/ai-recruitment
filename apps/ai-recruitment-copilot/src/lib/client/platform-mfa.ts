import { platformMfaHref, PLATFORM_MFA_PATH } from "@arc/shared/platform-security";
import { ApiError } from "./api/errors";

let accessGuard: { check: () => boolean; redirect: () => void } | undefined;

export function installPlatformMfaGuard(guard: NonNullable<typeof accessGuard>) {
  accessGuard = guard;
  return () => {
    if (accessGuard === guard) {
      accessGuard = undefined;
    }
  };
}

export function isPlatformMfaPage() {
  return (
    typeof window !== "undefined" &&
    (window.location.pathname === "/platform" ||
      window.location.pathname.startsWith("/platform/")) &&
    window.location.pathname !== PLATFORM_MFA_PATH
  );
}

export function isMfaRequiredPayload(payload: unknown) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "code" in payload &&
    ["MFA_REQUIRED", "MFA_ENROLLMENT_REQUIRED"].includes(String(payload.code))
  );
}

export function redirectToPlatformMfa() {
  if (!isPlatformMfaPage()) {
    return;
  }
  if (accessGuard) {
    accessGuard.redirect();
  } else {
    window.location.replace(
      platformMfaHref(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      ),
    );
  }
}

export async function platformFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (isPlatformMfaPage() && accessGuard && !accessGuard.check()) {
    redirectToPlatformMfa();
    throw new ApiError("后台验证已过期", { payload: { code: "MFA_REQUIRED" }, status: 403 });
  }
  const response = await fetch(input, init);
  if (isPlatformMfaPage() && (response.status === 401 || response.status === 403)) {
    const payload: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (isMfaRequiredPayload(payload)) {
      redirectToPlatformMfa();
    }
  }
  return response;
}
