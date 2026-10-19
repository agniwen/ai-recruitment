import { BlockList, isIP } from "node:net";
import { createHash } from "node:crypto";
import type { InterviewTrace } from "@arc/shared/interview-telemetry";
import { interviewTraceSchema } from "@arc/shared/interview-telemetry";
import { getRequestPeerIp } from "../../../../../lib/server/request-ip-context";

function isTrustedProxy(ip: string) {
  const proxies = new BlockList();
  const entries = (process.env.INTERVIEW_TELEMETRY_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address);
    if (!family || extra !== undefined) {
      throw new Error("Invalid INTERVIEW_TELEMETRY_TRUSTED_PROXIES configuration");
    }
    const type = family === 6 ? "ipv6" : "ipv4";
    if (prefix === undefined) {
      proxies.addAddress(address, type);
    } else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits > (family === 6 ? 128 : 32)) {
        throw new Error("Invalid INTERVIEW_TELEMETRY_TRUSTED_PROXIES configuration");
      }
      proxies.addSubnet(address, bits, type);
    }
  }
  return proxies.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

export function requestEvidence(headers: Headers, peerIp = getRequestPeerIp()) {
  const peer = peerIp && isIP(peerIp) ? peerIp : null;
  // Only configured transport peers may assert a client's address through headers.
  const candidates = [
    ["x-real-ip", headers.get("x-real-ip")?.trim()],
    ["x-forwarded-for", headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()],
  ] as const;
  const evidence =
    peer && isTrustedProxy(peer) ? candidates.find(([, value]) => value && isIP(value)) : undefined;
  const ipSource = peer ? "direct-connection" : "unavailable";
  return {
    ip: evidence?.[1] ?? peer,
    ipSource: evidence ? `trusted-proxy:${evidence[0]}` : ipSource,
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
