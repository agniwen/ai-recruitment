import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  interviewTelemetryEvent as event,
  platformSecurityAudit as audit,
} from "@arc/db-schema/schema";
import { installSecurityTestKeys } from "../../../../../test-utils/security-keys";
import { createSecurityTestDatabase } from "../../../../../test-utils/security-database";
import { decryptIp, ipContext } from "../../../../../lib/server/ip-encryption";
import { runWithRequestPeerIp } from "../../../../../lib/server/request-ip-context";
import { requireRecentMfa } from "../../../security/mfa/service";
import { loadMeetingLog } from "../../../platform/routes/interview-logs/dao";
import { logQuerySchema } from "../../../platform/routes/interview-logs/schema";
import { revealStoredIp } from "../../../platform/routes/interview-logs/routes/ip/dao";
import { saveClientEvents } from "./dao";

const state = vi.hoisted(() => ({
  database: null as Awaited<ReturnType<typeof createSecurityTestDatabase>> | null,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  get db() {
    if (!state.database) {
      throw new Error("Test database not initialized");
    }
    return state.database.db;
  },
}));
vi.mock("../../../security/mfa/service", () => ({ requireRecentMfa: vi.fn() }));
beforeAll(async () => {
  installSecurityTestKeys();
  state.database = await createSecurityTestDatabase();
});
afterAll(async () => {
  await state.database?.client.close();
  vi.unstubAllEnvs();
});

describe("encrypted WebRTC evidence", () => {
  it("encrypts public candidates separately from the HTTP IP and hides them from timeline responses", async () => {
    if (!state.database) {
      throw new Error("Missing database");
    }
    const meetingId = randomUUID();
    await runWithRequestPeerIp("203.0.113.9", () =>
      saveClientEvents(
        {
          meetingId,
          meetingTitle: "WebRTC test",
          organizationId: "workspace",
          participantIdentity: "candidate_test",
          participantName: "Test",
          participantRole: "candidate",
          roomName: "room",
        },
        [
          {
            clientSequence: 1,
            details: {
              webrtcAddress: "8.8.8.8",
              webrtcCandidateType: "srflx",
              webrtcDurationMs: 150,
              webrtcProtocol: "udp",
              webrtcServer: "hitv",
              webrtcStatus: "completed",
            },
            id: randomUUID(),
            occurredAt: new Date().toISOString(),
            tabId: randomUUID(),
            type: "webrtc_address_collected",
            visitId: randomUUID(),
          },
        ],
        new Headers(),
      ),
    );
    const [row] = await state.database.db
      .select()
      .from(event)
      .where(eq(event.meetingId, meetingId));
    expect(row.details.webrtcAddress).toMatch(/^ip:v1:/);
    expect(
      await decryptIp(String(row.details.webrtcAddress), ipContext("webrtc", "workspace", row.id)),
    ).toBe("8.8.8.8");
    if (!row.ip) {
      throw new Error("Missing request IP");
    }
    expect(await decryptIp(row.ip, ipContext("telemetry", "workspace", row.id))).toBe(
      "203.0.113.9",
    );
    await expect(
      decryptIp(String(row.details.webrtcAddress), ipContext("telemetry", "workspace", row.id)),
    ).rejects.toThrow();

    const timeline = await loadMeetingLog(meetingId, logQuerySchema.parse({}));
    expect(timeline.records[0]).toMatchObject({ hasIp: true, hasWebRtcAddress: true });
    expect(timeline.records[0].details).not.toHaveProperty("webrtcAddress");
    expect(JSON.stringify(timeline)).not.toContain("8.8.8.8");
    expect(JSON.stringify(timeline)).not.toContain("ip:v1:");

    const reference = { id: row.id, kind: "webrtc" as const, meetingId };
    const principal = { sessionId: "session", userId: "admin" };
    const headers = new Headers();
    vi.mocked(requireRecentMfa).mockResolvedValue("2026-10-23T12:00:00.000Z");
    expect(await revealStoredIp(reference, principal, headers)).toMatchObject({
      ip: "8.8.8.8",
      region: expect.stringContaining("美国"),
    });
    expect(requireRecentMfa).toHaveBeenCalledWith(principal, headers);
    expect(
      await revealStoredIp({ ...reference, meetingId: "other" }, principal, headers),
    ).toBeNull();
    vi.mocked(requireRecentMfa).mockRejectedValueOnce(new Error("MFA_REQUIRED"));
    await expect(revealStoredIp(reference, principal, headers)).rejects.toThrow("MFA_REQUIRED");
    const audits = await state.database.db
      .select()
      .from(audit)
      .where(eq(audit.action, "ip.reveal.webrtc"));
    expect(audits.map((item) => item.outcome)).toEqual(["success", "missing"]);
    expect(JSON.stringify(audits)).not.toContain("8.8.8.8");
    expect(JSON.stringify(audits)).not.toContain("ip:v1:");
  });
});
