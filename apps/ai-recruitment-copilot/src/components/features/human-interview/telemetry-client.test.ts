// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelemetryClient } from "./telemetry-client";
import { summarizeRtcStats } from "./rtc-stats";
vi.mock("@/lib/client/build-info", () => ({ BUILD_TIME: "test-release" }));
vi.mock("@/lib/client/rpc", () => ({ rpc: {} }));
vi.mock("@/lib/client/api", () => ({ rpcFetch: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
});

describe("interview telemetry buffer", () => {
  it("carries the browser fingerprint as first-class evidence across events and request headers", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({});
    const client = createTelemetryClient("candidate", "invite", send);
    client.emit("fingerprint_ready", {
      fingerprint: "a".repeat(32),
      fingerprintVersion: "fingerprintjs-test",
    });
    client.emit("connected");
    await client.flush();
    for (const event of send.mock.calls[0][0]) {
      expect(event).toMatchObject({
        browserId: expect.any(String),
        fingerprintId: "a".repeat(32),
        fingerprintVersion: "fingerprintjs-test",
      });
      expect(event.details).not.toHaveProperty("fingerprint");
    }
    expect(client.headers()["x-interview-fingerprint-id"]).toBe("a".repeat(32));
    const nextVisit = createTelemetryClient("candidate", "invite", send);
    expect(nextVisit.trace.browserId).toBe(client.trace.browserId);
    expect(nextVisit.trace.visitId).not.toBe(client.trace.visitId);
    expect(nextVisit.trace.tabId).not.toBe(client.trace.tabId);
    client.dispose();
    nextVisit.dispose();
  });
  it("sends final events with keepalive while a normal request is still in flight", async () => {
    vi.useFakeTimers();
    const deferred = Promise.withResolvers<boolean>();
    const send = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue({});
    const client = createTelemetryClient("candidate", "invite", send);
    client.opened();
    client.emit("page_exit", { persisted: false });
    await client.flush(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toBe(true);
    expect(send.mock.calls[1][0][0]).toMatchObject({ clientSequence: 2, type: "page_exit" });
    deferred.resolve(true);
    client.dispose();
  });
  it("keeps tab and attempt identity separate, even in the same browser", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({});
    const candidate = createTelemetryClient("candidate", "candidate-link", send);
    const interviewer = createTelemetryClient("interviewer", "interviewer-link", send);
    expect(candidate.trace.tabId).not.toBe(interviewer.trace.tabId);
    candidate.startAttempt();
    const first = candidate.trace.attemptId;
    await Promise.resolve();
    candidate.startAttempt();
    expect(candidate.trace.attemptId).not.toBe(first);
    candidate.dispose();
    interviewer.dispose();
  });
  it("retries the same event ID after transport failure and records explicit leave separately", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const client = createTelemetryClient("candidate", "invite", send);
    client.emit("disconnected", { reason: "DUPLICATE_IDENTITY" });
    await client.flush();
    const [[[{ id }]]] = send.mock.calls;
    await client.flush();
    expect(send.mock.calls[1][0][0].id).toBe(id);
    client.emit("leave_clicked");
    await client.flush();
    expect(send.mock.calls[2][0][0].type).toBe("leave_clicked");
    expect(JSON.stringify(send.mock.calls)).not.toContain("invite");
    client.dispose();
  });
  it("bounds offline buffering and reports dropped records", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({});
    const client = createTelemetryClient("candidate", "invite", send);
    for (let i = 0; i < 250; i += 1) {
      client.emit("heartbeat");
    }
    for (let i = 0; i < 12; i += 1) {
      await client.flush();
    }
    const events = send.mock.calls.flatMap(([batch]) => batch);
    expect(events).toHaveLength(200);
    expect(events.at(-1).details.droppedEvents).toBe(50);
    client.dispose();
  });
});

describe("RTC quality sampling", () => {
  it("keeps counters and selected transport without IPs, SDP or track labels", () => {
    const rows = [
      {
        bytesReceived: 5000,
        id: "in",
        jitter: 0.02,
        packetsLost: -1,
        packetsReceived: 20,
        type: "inbound-rtp",
      },
      { bytesSent: 9000, id: "out", type: "outbound-rtp" },
      {
        currentRoundTripTime: 0.1,
        id: "pair",
        localCandidateId: "local",
        nominated: true,
        remoteCandidateId: "remote",
        state: "succeeded",
        type: "candidate-pair",
      },
      {
        address: "private-ip",
        candidateType: "relay",
        id: "local",
        protocol: "udp",
        type: "local-candidate",
      },
      { candidateType: "srflx", id: "remote", type: "remote-candidate" },
    ];
    const report = new Map(rows.map((r) => [r.id, r])) as RTCStatsReport;
    const summary = summarizeRtcStats([report, report]);
    expect(summary).toMatchObject({
      bytesReceived: 5000,
      bytesSent: 9000,
      jitterMs: 20,
      localCandidateType: "relay",
      packetsLost: 0,
      protocol: "udp",
      rttMs: 100,
    });
    expect(JSON.stringify(summary)).not.toContain("private-ip");
  });
});
