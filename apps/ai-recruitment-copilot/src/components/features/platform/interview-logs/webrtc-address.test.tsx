// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { WebRtcAddress } from "./webrtc-address";
import type { TimelineEvent } from "./api";

vi.mock("../security/ip-reveal", () => ({
  IpReveal: ({ reference }: { reference: { kind: string; id: string; meetingId: string } }) => (
    <button data-reference={JSON.stringify(reference)}>查看 IP</button>
  ),
}));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  document.body.innerHTML = "";
});
const base: TimelineEvent = {
  attemptId: null,
  browserId: null,
  clientSequence: 1,
  details: {},
  eventKey: "key",
  fingerprintId: null,
  fingerprintVersion: null,
  hasIp: true,
  hasWebRtcAddress: true,
  id: "event",
  ipSource: "direct-connection",
  meetingId: "meeting",
  meetingTitle: "面试",
  occurredAt: "2026-10-23T01:00:00Z",
  organizationId: "org",
  participantIdentity: "candidate",
  participantName: "候选人",
  participantRole: "candidate",
  participantSid: null,
  receivedAt: "2026-10-23T01:00:00Z",
  roomName: null,
  roomSid: null,
  source: "client",
  tabId: null,
  type: "webrtc_address_collected",
  userAgent: null,
  visitId: null,
};
describe("WebRTC address evidence", () => {
  it("shows the address control without extra collection details", async () => {
    rendered = await renderInAct(
      <WebRtcAddress
        event={{
          ...base,
          details: {
            webrtcDurationMs: 150,
            webrtcServer: "hitv",
            webrtcStatus: "timeout",
          },
        }}
      />,
    );
    expect(document.body.textContent).toContain("WebRTC IP · HiTV");
    expect(document.body.textContent).not.toContain("150 ms");
    expect(document.body.textContent).not.toContain("超时");
    expect(document.querySelector("button")?.dataset.reference).toBe(
      JSON.stringify({
        id: "event",
        kind: "webrtc",
        meetingId: "meeting",
      }),
    );
    expect(document.body.textContent).not.toContain("真实 IP");
  });
  it("shows a timeout without a reveal control or a VPN conclusion", async () => {
    rendered = await renderInAct(
      <WebRtcAddress
        event={{
          ...base,
          details: {
            webrtcDurationMs: 5000,
            webrtcServer: "bilibili",
            webrtcStatus: "timeout",
          },
          hasWebRtcAddress: false,
        }}
      />,
    );
    expect(document.body.textContent).toContain("采集超时");
    expect(document.querySelector("button")).toBeNull();
    expect(document.body.textContent).not.toContain("VPN");
  });
});
