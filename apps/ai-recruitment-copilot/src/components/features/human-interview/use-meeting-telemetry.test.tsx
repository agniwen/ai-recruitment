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
  document.body.innerHTML = "";
});
describe("meeting lifecycle collection", () => {
  it("collects fingerprint, network changes and page exit, then removes listeners on unmount", async () => {
    rendered = await renderInAct(<Page />);
    expect(createTelemetryClient).toHaveBeenCalledWith("interviewer", "private-invite");
    expect(clients.opened).toHaveBeenCalledOnce();
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
    clients.emit.mockClear();
    window.dispatchEvent(new Event("offline"));
    expect(clients.emit).not.toHaveBeenCalled();
  });
});
