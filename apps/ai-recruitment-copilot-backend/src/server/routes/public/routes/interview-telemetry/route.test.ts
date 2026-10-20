import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { saveClientEvents } from "./dao";
import { createInterviewTelemetryRouter } from "./route";
import { createTelemetryLimiter, requestEvidence } from "./utils";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));
const scope = {
  meetingId: "meeting",
  meetingTitle: "面试",
  organizationId: "org",
  participantIdentity: "candidate_round",
  participantName: "Miles",
  participantRole: "candidate",
  roomName: "human_room",
};
const resolve = vi.fn();
const save = vi.fn<typeof saveClientEvents>();
const event = {
  clientSequence: 1,
  details: { reason: "DUPLICATE_IDENTITY" },
  id: "00000000-0000-4000-8000-000000000001",
  occurredAt: "2026-10-08T01:00:00.000Z",
  tabId: "00000000-0000-4000-8000-000000000003",
  type: "disconnected",
  visitId: "00000000-0000-4000-8000-000000000002",
};
const request = (body: unknown, auth = "Bearer signed-invite") =>
  new Request("https://example.test/", {
    body: JSON.stringify(body),
    headers: { Authorization: auth, "Content-Type": "application/json" },
    method: "POST",
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "127.0.0.1/32, ::1/128");
  resolve.mockResolvedValue(scope);
  save.mockResolvedValue();
});
afterEach(() => vi.unstubAllEnvs());

describe("interview telemetry intake", () => {
  it("takes identity only from the signed invite and accepts final disconnect events", async () => {
    const app = createInterviewTelemetryRouter({ resolve, save });
    const response = await app.request(request({ events: [event], mode: "candidate" }));
    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith("candidate", "signed-invite");
    expect(save).toHaveBeenCalledWith(scope, [event], expect.any(Headers));
  });
  it("rejects forged roles, arbitrary payload fields and oversized batches", async () => {
    const app = createInterviewTelemetryRouter({ resolve, save });
    for (const body of [
      { events: [event], mode: "admin" },
      { events: [{ ...event, participantIdentity: "other" }], mode: "candidate" },
      { events: [{ ...event, details: { token: "secret" } }], mode: "candidate" },
      { events: Array.from({ length: 21 }, () => event), mode: "candidate" },
    ]) {
      const response = await app.request(request(body));
      expect(response.status).toBe(400);
    }
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects absent or invalid invitations", async () => {
    const app = createInterviewTelemetryRouter({ resolve, save });
    const absent = await app.request(request({ events: [event], mode: "candidate" }, ""));
    expect(absent.status).toBe(401);
    resolve.mockResolvedValue(null);
    const invalid = await app.request(request({ events: [event], mode: "candidate" }));
    expect(invalid.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
  it("returns retryable failure when persistence fails", async () => {
    save.mockRejectedValue(new Error("database secret"));
    const response = await createInterviewTelemetryRouter({ resolve, save }).request(
      request({ events: [event], mode: "candidate" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database secret");
  });
  it("bounds requests per invite and resets after a minute", () => {
    const allow = createTelemetryLimiter();
    for (let i = 0; i < 120; i += 1) {
      expect(allow("same", 0)).toBe(true);
    }
    expect(allow("same", 1)).toBe(false);
    expect(allow("other", 1)).toBe(true);
    expect(allow("same", 60_001)).toBe(true);
  });
  it("collects x-real-ip without a configured header", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1, 127.0.0.1",
      "x-real-ip": "203.0.113.5",
    });
    vi.stubEnv("INTERVIEW_TELEMETRY_IP_HEADER", "");
    try {
      expect(requestEvidence(headers, "127.0.0.1")).toMatchObject({
        ip: "203.0.113.5",
        ipSource: "trusted-proxy:x-real-ip",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each(["development", "production"])("captures direct connections in %s", (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "");
    expect(requestEvidence(new Headers(), "::1")).toMatchObject({
      ip: "::1",
      ipSource: "direct-connection",
    });
  });
  it("ignores spoofed headers from a direct client", () => {
    const headers = new Headers({
      "x-arc-dev-peer-ip": "203.0.113.99",
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.99",
    });
    expect(requestEvidence(headers, "198.51.100.2")).toMatchObject({
      ip: "198.51.100.2",
      ipSource: "direct-connection",
    });
    expect(requestEvidence(headers)).toMatchObject({ ip: null, ipSource: "unavailable" });
  });
  it("trusts only the configured proxy network", () => {
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "10.20.0.0/24,2001:db8:1::/64");
    const headers = new Headers({ "x-real-ip": "203.0.113.5" });
    for (const peer of ["10.20.0.2", "2001:db8:1::2"]) {
      expect(requestEvidence(headers, peer).ipSource).toBe("trusted-proxy:x-real-ip");
    }
    expect(requestEvidence(headers, "10.21.0.2").ipSource).toBe("direct-connection");
  });
  it("does not trust a proxy by default", () => {
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "");
    expect(requestEvidence(new Headers({ "x-real-ip": "203.0.113.5" }), "127.0.0.1")).toMatchObject(
      { ip: "127.0.0.1", ipSource: "direct-connection" },
    );
  });
  it("handles IPv4-mapped connection addresses", () => {
    expect(
      requestEvidence(new Headers({ "x-real-ip": "203.0.113.5" }), "::ffff:127.0.0.1"),
    ).toMatchObject({ ip: "203.0.113.5", ipSource: "trusted-proxy:x-real-ip" });
  });
  it("reports unavailable when no valid transport address exists", () => {
    expect(requestEvidence(new Headers(), "invalid")).toMatchObject({
      ip: null,
      ipSource: "unavailable",
    });
  });
  it.each(["not-an-ip", "127.0.0.1/33", "::1/129", "127.0.0.1//"])(
    "rejects invalid proxy configuration: %s",
    (value) => {
      vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", value);
      expect(() => requestEvidence(new Headers(), "127.0.0.1")).toThrow(
        "Invalid INTERVIEW_TELEMETRY_TRUSTED_PROXIES configuration",
      );
    },
  );
  it.each<[string, Record<string, string>, string | null]>([
    ["missing x-real-ip", { "x-forwarded-for": "198.51.100.1, 127.0.0.1" }, "198.51.100.1"],
    [
      "invalid x-real-ip",
      { "x-forwarded-for": "198.51.100.1", "x-real-ip": "invalid" },
      "198.51.100.1",
    ],
    ["blank x-real-ip", { "x-forwarded-for": "198.51.100.1", "x-real-ip": " " }, "198.51.100.1"],
    ["IPv6", { "x-forwarded-for": "2001:db8::1, 127.0.0.1" }, "2001:db8::1"],
    ["whitespace", { "x-forwarded-for": " 198.51.100.1 , 127.0.0.1" }, "198.51.100.1"],
    ["invalid first address", { "x-forwarded-for": "unknown, 127.0.0.1" }, null],
    ["IP with a port", { "x-forwarded-for": "198.51.100.1:1234" }, null],
    ["missing headers", {}, null],
  ])("falls back to the first forwarded address: %s", (_name, values, ip) => {
    const headers = new Headers(values);
    expect(requestEvidence(headers, "127.0.0.1")).toMatchObject({
      ip: ip ?? "127.0.0.1",
      ipSource: ip ? "trusted-proxy:x-forwarded-for" : "direct-connection",
    });
  });
});
