import { useCallback, useEffect, useRef } from "react";
import type {
  InterviewClientEventType,
  InterviewEventDetails,
} from "@arc/shared/interview-telemetry";
import { createTelemetryClient, readNetwork } from "./telemetry-client";
import type { BrowserNetwork, TelemetryClient } from "./telemetry-client";
import { collectWebRtcAddress } from "./webrtc-address";
import type { WebRtcServer } from "@arc/shared/interview-webrtc";

export function useMeetingTelemetry(mode: "candidate" | "interviewer", inviteToken: string) {
  const client = useRef<TelemetryClient | null>(null);
  useEffect(() => {
    const recorder = createTelemetryClient(mode, inviteToken);
    client.current = recorder;
    recorder.opened();
    let active = true;
    let webRtcController = new AbortController();
    let lastWebRtcProbe = 0;
    let webRtcTimer: ReturnType<typeof setTimeout> | undefined;
    async function sampleServer(server: WebRtcServer, signal: AbortSignal) {
      const result = await collectWebRtcAddress(server, signal);
      if (!active || signal.aborted || !result) {
        return;
      }
      for (const candidate of result.candidates.length ? result.candidates : [undefined]) {
        recorder.emit("webrtc_address_collected", {
          webrtcAddress: candidate?.address,
          webrtcCandidateType: candidate?.type,
          webrtcDurationMs: result.durationMs,
          webrtcProtocol: candidate?.protocol,
          webrtcServer: server,
          webrtcStatus: result.status,
        });
      }
      void recorder.flush();
    }
    function sampleWebRtc() {
      if (!active || !navigator.onLine) {
        return;
      }
      if (webRtcController.signal.aborted) {
        webRtcController = new AbortController();
      }
      lastWebRtcProbe = Date.now();
      for (const server of ["bilibili", "hitv"] as const) {
        void sampleServer(server, webRtcController.signal);
      }
    }
    function scheduleWebRtc() {
      clearTimeout(webRtcTimer);
      webRtcTimer = setTimeout(sampleWebRtc, Math.max(1000, lastWebRtcProbe + 30_000 - Date.now()));
    }
    sampleWebRtc();
    async function fingerprint() {
      try {
        const fp = await import("@fingerprintjs/fingerprintjs");
        const agent = await fp.load({ monitoring: false });
        const result = await agent.get();
        if (active) {
          recorder.emit("fingerprint_ready", {
            fingerprint: result.visitorId,
            fingerprintVersion: `fingerprintjs-${result.version}`,
          });
        }
      } catch {
        if (active) {
          recorder.emit("fingerprint_failed");
        }
      }
    }
    void fingerprint();
    const visibility = () => {
      recorder.emit(document.hidden ? "page_hidden" : "page_visible");
      void recorder.flush(true);
    };
    const pagehide = (event: PageTransitionEvent) => {
      clearTimeout(webRtcTimer);
      webRtcController.abort();
      recorder.emit("page_exit", { persisted: event.persisted });
      void recorder.flush(true);
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        recorder.emit("page_restored", { persisted: true });
        scheduleWebRtc();
      }
    };
    const network = () => {
      recorder.emit("network_changed", readNetwork());
      void recorder.flush();
      scheduleWebRtc();
    };
    const error = () => recorder.emit("client_error", { errorName: "window_error" });
    const rejection = () => recorder.emit("client_error", { errorName: "unhandled_rejection" });
    const { connection } = navigator as Navigator & { connection?: BrowserNetwork };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    connection?.addEventListener("change", network);
    return () => {
      active = false;
      clearTimeout(webRtcTimer);
      webRtcController.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
      connection?.removeEventListener("change", network);
      recorder.dispose();
      client.current = null;
    };
  }, [mode, inviteToken]);
  const emit = useCallback((type: InterviewClientEventType, details?: InterviewEventDetails) => {
    client.current?.emit(type, details);
  }, []);
  const headers = useCallback(() => client.current?.headers() ?? {}, []);
  const startAttempt = useCallback(() => {
    client.current?.startAttempt();
  }, []);
  const flush = useCallback(() => {
    void client.current?.flush(true);
  }, []);
  const setRoom = useCallback((room: { roomSid?: string; participantSid?: string }) => {
    client.current?.setRoom(room);
  }, []);
  return { emit, flush, headers, setRoom, startAttempt };
}
