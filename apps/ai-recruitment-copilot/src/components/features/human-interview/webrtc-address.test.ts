import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectWebRtcAddress } from "./webrtc-address";

class Peer {
  static instances: Peer[] = [];
  onicecandidate: ((event: { candidate: Partial<RTCIceCandidate> | null }) => void) | null = null;
  close = vi.fn();
  createDataChannel = vi.fn();
  createOffer = vi.fn().mockResolvedValue({ sdp: "not recorded", type: "offer" });
  setLocalDescription = vi.fn(() => Promise.resolve());
  config: RTCConfiguration;
  constructor(config: RTCConfiguration) {
    this.config = config;
    Peer.instances.push(this);
  }
  candidate(address: string, type = "srflx", protocol: RTCIceProtocol | null = "udp") {
    this.onicecandidate?.({ candidate: { address, protocol, type: type as RTCIceCandidateType } });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Peer.instances = [];
  vi.stubGlobal("RTCPeerConnection", Peer);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded STUN collection", () => {
  it("records only public non-relay candidates and deduplicates IPv6", async () => {
    const result = collectWebRtcAddress("hitv", new AbortController().signal);
    const [peer] = Peer.instances;
    expect(peer.config.iceServers).toEqual([{ urls: "stun:stun.hitv.com:3478" }]);
    expect(peer.createDataChannel).toHaveBeenCalledOnce();
    peer.candidate("192.168.1.1", "host");
    peer.candidate("browser.local", "host");
    peer.candidate("8.8.8.8", "relay");
    peer.candidate("1.1.1.1", "srflx", null);
    peer.candidate("8.8.8.8");
    peer.candidate("8.8.8.8");
    peer.candidate("2606:4700::1111", "host");
    peer.candidate("2606:4700:0:0:0:0:0:1111", "host");
    peer.onicecandidate?.({ candidate: null });
    expect(await result).toMatchObject({
      candidates: [
        { address: "8.8.8.8", protocol: "udp", type: "srflx" },
        { address: "2606:4700::1111", protocol: "udp", type: "host" },
      ],
      server: "hitv",
      status: "completed",
    });
    expect(peer.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains candidates on timeout and caps their number", async () => {
    const result = collectWebRtcAddress("bilibili", new AbortController().signal);
    const [peer] = Peer.instances;
    for (let i = 1; i <= 10; i += 1) {
      peer.candidate(`8.8.8.${i}`);
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ status: "timeout" });
    const observation = await result;
    expect(observation?.candidates).toHaveLength(4);
    expect(peer.close).toHaveBeenCalledOnce();
  });
  it("closes on abort without publishing a result or setting a late offer", async () => {
    const controller = new AbortController();
    const result = collectWebRtcAddress("hitv", controller.signal);
    const [peer] = Peer.instances;
    controller.abort();
    expect(await result).toBeNull();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(peer.setLocalDescription).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not create a connection for an already cancelled visit", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await collectWebRtcAddress("hitv", controller.signal)).toBeNull();
    expect(Peer.instances).toHaveLength(0);
  });
  it("handles unsupported browsers and construction failures without throwing", async () => {
    vi.stubGlobal("RTCPeerConnection", null);
    expect(await collectWebRtcAddress("hitv", new AbortController().signal)).toMatchObject({
      status: "unsupported",
    });
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn(function disabledPeer() {
        throw new Error("disabled");
      }),
    );
    expect(await collectWebRtcAddress("hitv", new AbortController().signal)).toMatchObject({
      status: "failed",
    });
  });
});
