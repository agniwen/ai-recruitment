import { isIP } from "node:net";
import { createHash } from "node:crypto";
import type { InterviewTrace } from "@arc/shared/interview-telemetry";
import { interviewTraceSchema } from "@arc/shared/interview-telemetry";

export function requestEvidence(headers: Headers) {
  // The reverse proxy must overwrite these headers and block direct backend access.
  const candidates = [
    ["x-real-ip", headers.get("x-real-ip")?.trim()],
    ["x-forwarded-for", headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()],
  ] as const;
  const evidence = candidates.find(([, value]) => value && isIP(value));
  return {
    ip: evidence?.[1] ?? null,
    ipSource: evidence ? `trusted-proxy:${evidence[0]}` : "unavailable",
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}

export function readInterviewTrace(headers: Headers): Partial<InterviewTrace> {
  const result = interviewTraceSchema.safeParse({
    attemptId: headers.get("x-interview-attempt-id") ?? undefined,
    browserId: headers.get("x-interview-browser-id") ?? undefined,
    fingerprintId: headers.get("x-interview-fingerprint-id") ?? undefined,
    fingerprintVersion: headers.get("x-interview-fingerprint-version") ?? undefined,
    tabId: headers.get("x-interview-tab-id"),
    visitId: headers.get("x-interview-visit-id"),
  });
  return result.success ? result.data : {};
}

// Bounded per-process abuse protection. Shared DB uniqueness additionally deduplicates retries.
export function createTelemetryLimiter() {
  const windows = new Map<string, { count: number; until: number }>();
  return (invite: string, now = Date.now()) => {
    const key = createHash("sha256").update(invite).digest("hex");
    const current = windows.get(key);
    if (current && current.until > now) {
      current.count += 1;
      return current.count <= 120;
    }
    if (windows.size >= 5000) {
      for (const [entry, window] of windows) {
        if (window.until <= now) {
          windows.delete(entry);
        }
      }
      if (windows.size >= 5000) {
        return false;
      }
    }
    windows.set(key, { count: 1, until: now + 60_000 });
    return true;
  };
}
