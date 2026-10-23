import { normalizeWebRtcAddress, webRtcServers } from "@arc/shared/interview-webrtc";
import type { WebRtcServer } from "@arc/shared/interview-webrtc";

interface WebRtcCandidate {
  address: string;
  type: "host" | "srflx";
  protocol: "udp" | "tcp";
}
interface WebRtcObservation {
  server: WebRtcServer;
  status: "completed" | "timeout" | "unsupported" | "failed";
  durationMs: number;
  candidates: WebRtcCandidate[];
}

export function collectWebRtcAddress(
  server: WebRtcServer,
  signal: AbortSignal,
): Promise<WebRtcObservation | null> {
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  if (typeof RTCPeerConnection !== "function") {
    return Promise.resolve({ candidates: [], durationMs: 0, server, status: "unsupported" });
  }
  // ICE is callback-based; this promise bridges its events to one bounded result.
  // oxlint-disable-next-line promise/avoid-new
  return new Promise((resolve) => {
    const started = performance.now();
    const candidates: WebRtcCandidate[] = [];
    let connection: RTCPeerConnection | undefined;
    let finished = false;
    const resources: { timeout?: ReturnType<typeof setTimeout>; abort?: () => void } = {};
    function finish(status: WebRtcObservation["status"]) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(resources.timeout);
      if (resources.abort) {
        signal.removeEventListener("abort", resources.abort);
      }
      if (connection) {
        connection.onicecandidate = null;
        connection.close();
      }
      // Guarded above: end-of-candidates, abort and timeout may all fire.
      // oxlint-disable-next-line promise/no-multiple-resolved
      resolve(
        signal.aborted
          ? null
          : {
              candidates,
              durationMs: Math.round(performance.now() - started),
              server,
              status,
            },
      );
    }
    resources.abort = () => finish("failed");
    resources.timeout = setTimeout(() => finish("timeout"), 5000);
    signal.addEventListener("abort", resources.abort, { once: true });
    try {
      connection = new RTCPeerConnection({ iceServers: [{ urls: webRtcServers[server] }] });
      connection.onicecandidate = ({ candidate }) => {
        if (!candidate) {
          finish("completed");
          return;
        }
        if (candidates.length >= 4 || (candidate.type !== "srflx" && candidate.type !== "host")) {
          return;
        }
        if (candidate.protocol !== "udp" && candidate.protocol !== "tcp") {
          return;
        }
        const address = normalizeWebRtcAddress(candidate.address ?? "");
        if (
          !address ||
          candidates.some(
            (item) =>
              item.address === address &&
              item.type === candidate.type &&
              item.protocol === candidate.protocol,
          )
        ) {
          return;
        }
        candidates.push({ address, protocol: candidate.protocol, type: candidate.type });
      };
      // A data channel gathers ICE without opening the camera or microphone.
      connection.createDataChannel("interview-network-diagnostics");
      const peer = connection;
      const offer = async () => {
        try {
          const description = await peer.createOffer();
          if (!finished) {
            await peer.setLocalDescription(description);
          }
        } catch {
          finish("failed");
        }
      };
      void offer();
      // Individual ICE errors (including 701) may coexist with valid candidates.
    } catch {
      finish("failed");
    }
  });
}
