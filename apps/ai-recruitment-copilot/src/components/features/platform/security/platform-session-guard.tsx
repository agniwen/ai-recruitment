import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { platformMfaHref } from "@arc/shared/platform-security";
import { installPlatformMfaGuard } from "@/lib/client/platform-mfa";
import { fetchMfaStatus, needsMfa, renewMfaActivity } from "./api";

const ACTIVITY_INTERVAL_MS = 60_000;

export function PlatformSessionGuard({
  children,
  expiresAt,
}: {
  children: ReactNode;
  expiresAt: string;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let expiry = Date.parse(expiresAt);
    let idleTimer: ReturnType<typeof setTimeout>;
    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    let lastActivity = 0;
    let lastSent = 0;
    let pending = false;
    let redirecting = false;

    function redirect() {
      if (redirecting || controller.signal.aborted) {
        return;
      }
      redirecting = true;
      setBlocked(true);
      void router.navigate({ href: platformMfaHref(router.state.location.href), replace: true });
    }
    function check() {
      return !redirecting && Date.now() < expiry;
    }
    function scheduleExpiry(value: string) {
      expiry = Math.max(expiry, Date.parse(value));
      clearTimeout(idleTimer);
      idleTimer = setTimeout(redirect, Math.max(0, expiry - Date.now()));
    }
    async function sendActivity() {
      activityTimer = undefined;
      if (pending || controller.signal.aborted || !lastActivity) {
        return;
      }
      if (!check()) {
        redirect();
        return;
      }
      pending = true;
      lastSent = Date.now();
      try {
        const result = await renewMfaActivity(lastActivity, controller.signal);
        if (!controller.signal.aborted) {
          scheduleExpiry(result.expiresAt);
        }
      } catch (error) {
        if (!controller.signal.aborted && needsMfa(error)) {
          redirect();
        }
      } finally {
        pending = false;
      }
    }
    function onActivity(event: Event) {
      if (document.hidden) {
        return;
      }
      if (!check()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        redirect();
        return;
      }
      lastActivity = Date.now();
      if (activityTimer === undefined) {
        const wait = Math.max(0, lastSent + ACTIVITY_INTERVAL_MS - Date.now());
        activityTimer = setTimeout(() => void sendActivity(), wait);
      }
    }
    async function onFocus() {
      if (document.hidden) {
        return;
      }
      if (!check()) {
        redirect();
        return;
      }
      try {
        const status = await fetchMfaStatus(controller.signal);
        if (!controller.signal.aborted) {
          if (status.expiresAt) {
            scheduleExpiry(status.expiresAt);
          } else {
            redirect();
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && needsMfa(error)) {
          redirect();
        }
      }
    }
    const removeGuard = installPlatformMfaGuard({ check, redirect });
    scheduleExpiry(expiresAt);
    const events = ["pointerdown", "pointermove", "keydown", "click", "submit", "scroll"];
    for (const event of events) {
      document.addEventListener(event, onActivity, true);
    }
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      clearTimeout(idleTimer);
      clearTimeout(activityTimer);
      removeGuard();
      for (const event of events) {
        document.removeEventListener(event, onActivity, true);
      }
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [expiresAt, router]);
  return blocked ? null : children;
}
