import { beforeEach, describe, expect, it, vi } from "vitest";
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
  resolve.mockResolvedValue(scope);
  save.mockResolvedValue();
});

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
  it("does not trust forwarded headers unless explicitly configured", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1, 127.0.0.1",
      "x-real-ip": "203.0.113.5",
    });
    vi.stubEnv("INTERVIEW_TELEMETRY_IP_HEADER", "");
    expect(requestEvidence(headers).ip).toBeNull();
    vi.stubEnv("INTERVIEW_TELEMETRY_IP_HEADER", "x-real-ip");
    expect(requestEvidence(headers).ip).toBe("203.0.113.5");
    headers.set("x-real-ip", "invalid");
    expect(requestEvidence(headers).ip).toBeNull();
    vi.unstubAllEnvs();
  });
});
