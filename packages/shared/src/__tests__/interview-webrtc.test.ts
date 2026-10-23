import { describe, expect, it } from "vitest";
import { normalizeWebRtcAddress } from "../interview-webrtc";
import { interviewClientEventSchema } from "../interview-telemetry";

describe("WebRTC public addresses", () => {
  it.each(["8.8.8.8", "1.1.1.1", "240e:1::1", "2606:4700::1111"])(
    "accepts public address %s",
    (ip) => expect(normalizeWebRtcAddress(ip)).toBe(ip),
  );
  it("canonicalizes IPv6 for deduplication", () => {
    expect(normalizeWebRtcAddress("2606:4700:0000:0000:0000:0000:0000:1111")).toBe(
      "2606:4700::1111",
    );
  });
  it.each([
    "",
    "browser.local",
    "not-an-ip",
    "256.1.1.1",
    "0.0.0.0",
    "10.0.0.1",
    "127.1.2.3",
    "100.64.1.1",
    "169.254.1.1",
    "172.16.1.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.1.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "::ffff:192.168.1.1",
    "2001:db8::1",
  ])("excludes non-public address %s", (ip) => {
    expect(normalizeWebRtcAddress(ip)).toBeNull();
  });
});

describe("WebRTC telemetry contract", () => {
  const event = {
    clientSequence: 1,
    details: {
      webrtcAddress: "8.8.8.8",
      webrtcCandidateType: "srflx",
      webrtcDurationMs: 150,
      webrtcProtocol: "udp",
      webrtcServer: "hitv",
      webrtcStatus: "completed",
    },
    id: "00000000-0000-4000-8000-000000000001",
    occurredAt: "2026-10-23T01:00:00.000Z",
    tabId: "00000000-0000-4000-8000-000000000002",
    type: "webrtc_address_collected",
    visitId: "00000000-0000-4000-8000-000000000003",
  };
  it("accepts a bounded observation or a timeout without an address", () => {
    expect(interviewClientEventSchema.safeParse(event).success).toBe(true);
    expect(
      interviewClientEventSchema.safeParse({
        ...event,
        details: { webrtcDurationMs: 5000, webrtcServer: "bilibili", webrtcStatus: "timeout" },
      }).success,
    ).toBe(true);
  });
  it.each([
    {},
    { ...event.details, webrtcAddress: "192.168.1.1" },
    { ...event.details, webrtcServer: "https://arbitrary.example" },
    { ...event.details, webrtcCandidateType: "relay" },
    { ...event.details, webrtcProtocol: undefined },
    { ...event.details, sdp: "private SDP" },
  ])("rejects invalid or incomplete observations", (details) => {
    expect(interviewClientEventSchema.safeParse({ ...event, details }).success).toBe(false);
  });
});
