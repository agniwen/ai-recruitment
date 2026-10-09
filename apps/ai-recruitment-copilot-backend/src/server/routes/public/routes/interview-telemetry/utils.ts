import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { interviewTraceSchema } from "@arc/shared/interview-telemetry";

export function requestEvidence(headers: Headers) {
  // Enable only behind a proxy which OVERWRITES this header and blocks direct backend access.
  const header = process.env.INTERVIEW_TELEMETRY_IP_HEADER?.toLowerCase();
  const value = header ? headers.get(header)?.trim() : null;
  return {
    ip: value && isIP(value) ? value : null,
    ipSource: value && isIP(value) ? `trusted-proxy:${header}` : "unavailable",
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}

export function readInterviewTrace(headers: Headers) {
  const result = interviewTraceSchema.safeParse({
    attemptId: headers.get("x-interview-attempt-id") ?? undefined,
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
