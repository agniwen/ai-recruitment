// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { useMeetingTelemetry } from "./use-meeting-telemetry";
import { createTelemetryClient } from "./telemetry-client";
import { collectWebRtcAddress } from "./webrtc-address";

const clients = vi.hoisted(() => ({
  dispose: vi.fn(),
  emit: vi.fn(),
  flush: vi.fn(),
  opened: vi.fn(),
}));
vi.mock("./telemetry-client", () => ({
  createTelemetryClient: vi.fn(() => clients),
  readNetwork: () => ({ online: navigator.onLine }),
}));
vi.mock("@fingerprintjs/fingerprintjs", () => ({
  load: () =>
    Promise.resolve({ get: () => Promise.resolve({ version: "test", visitorId: "a".repeat(32) }) }),
}));
vi.mock("./webrtc-address", () => ({
  collectWebRtcAddress: vi.fn((server: string) =>
    Promise.resolve({
      candidates: [{ address: "8.8.8.8", protocol: "udp", type: "srflx" }],
      durationMs: 100,
      server,
      status: "completed",
    }),
  ),
}));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
function Page() {
  useMeetingTelemetry("interviewer", "private-invite");
  return null;
}
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});
describe("meeting lifecycle collection", () => {
  it("collects fingerprint, network changes and page exit, then removes listeners on unmount", async () => {
    rendered = await renderInAct(<Page />);
    expect(createTelemetryClient).toHaveBeenCalledWith("interviewer", "private-invite");
    expect(clients.opened).toHaveBeenCalledOnce();
    await waitForUi(() =>
      expect(clients.emit).toHaveBeenCalledWith(
        "webrtc_address_collected",
        expect.objectContaining({ webrtcAddress: "8.8.8.8", webrtcServer: "hitv" }),
      ),
    );
    await waitForUi(() =>
      expect(clients.emit).toHaveBeenCalledWith(
        "fingerprint_ready",
        expect.objectContaining({ fingerprint: "a".repeat(32) }),
      ),
    );
    act(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    });
    expect(clients.emit).toHaveBeenCalledWith("network_changed", expect.any(Object));
    expect(clients.emit).toHaveBeenCalledWith("page_exit", { persisted: false });
    expect(clients.flush).toHaveBeenCalledWith(true);
    expect(JSON.stringify(clients.emit.mock.calls)).not.toContain("private-invite");
    await unmountInAct(rendered.root);
    rendered = undefined;
    expect(clients.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(collectWebRtcAddress).mock.calls[0][1].aborted).toBe(true);
    clients.emit.mockClear();
    window.dispatchEvent(new Event("offline"));
    expect(clients.emit).not.toHaveBeenCalled();
  });
  it("debounces and limits repeated network-change probes, cancelling scheduled work on unmount", async () => {
    vi.useFakeTimers();
    rendered = await renderInAct(<Page />);
    expect(collectWebRtcAddress).toHaveBeenCalledTimes(2);
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      vi.advanceTimersByTime(29_999);
    });
    expect(collectWebRtcAddress).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(collectWebRtcAddress).toHaveBeenCalledTimes(4);
    act(() => window.dispatchEvent(new Event("online")));
    await unmountInAct(rendered.root);
    rendered = undefined;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(collectWebRtcAddress).toHaveBeenCalledTimes(4);
  });
  it("cancels page-exit probes and creates a fresh signal when a cached page is restored", async () => {
    vi.useFakeTimers();
    rendered = await renderInAct(<Page />);
    const [[, firstSignal]] = vi.mocked(collectWebRtcAddress).mock.calls;
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(firstSignal.aborted).toBe(true);
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(collectWebRtcAddress).toHaveBeenCalledTimes(4);
    expect(vi.mocked(collectWebRtcAddress).mock.calls[2][1].aborted).toBe(false);
  });
});
