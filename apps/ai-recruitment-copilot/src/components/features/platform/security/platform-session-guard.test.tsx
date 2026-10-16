// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { platformFetch } from "@/lib/client/platform-mfa";
import { PlatformSessionGuard } from "./platform-session-guard";
import { fetchMfaStatus, renewMfaActivity } from "./api";

const state = vi.hoisted(() => ({
  router: {
    navigate: vi.fn(),
    state: { location: { href: "/platform/interview-logs?meetingId=test" } },
  },
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => state.router }));
vi.mock("./api", () => ({
  fetchMfaStatus: vi.fn(),
  needsMfa: (error: unknown) => error instanceof Error && error.message === "MFA_REQUIRED",
  renewMfaActivity: vi.fn(),
}));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
const start = new Date("2026-10-16T10:00:00Z").getTime();
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(start);
  window.history.replaceState(null, "", "/platform/interview-logs?meetingId=test");
  state.router.navigate.mockResolvedValue(null);
  vi.mocked(renewMfaActivity).mockImplementation((activeAt) =>
    Promise.resolve({
      expiresAt: new Date(activeAt + 900_000).toISOString(),
    }),
  );
  vi.mocked(fetchMfaStatus).mockResolvedValue({
    enrolled: true,
    expiresAt: new Date(start + 900_000).toISOString(),
  });
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function renderGuard(onClick = vi.fn()) {
  rendered = await renderInAct(
    <PlatformSessionGuard expiresAt={new Date(start + 900_000).toISOString()}>
      <button onClick={onClick}>操作</button>
    </PlatformSessionGuard>,
  );
}
describe("platform activity and expiry", () => {
  it("renews from actual activity, throttles traffic, and expires 15 minutes after the last activity", async () => {
    await renderGuard();
    await act(async () => {
      for (let minute = 1; minute <= 20; minute += 1) {
        await vi.advanceTimersByTimeAsync(60_000);
        document.dispatchEvent(new Event("pointermove", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(0);
      }
    });
    expect(state.router.navigate).not.toHaveBeenCalled();
    expect(renewMfaActivity).toHaveBeenCalledTimes(20);
    // A delayed status response must not shorten an already renewed grant.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state.router.navigate).not.toHaveBeenCalled();
    act(() => {
      for (let index = 0; index < 100; index += 1) {
        document.dispatchEvent(new Event("pointermove"));
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(renewMfaActivity).toHaveBeenCalledTimes(21);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(839_999);
    });
    expect(state.router.navigate).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(state.router.navigate).toHaveBeenCalledWith({
      href: "/platform/verify?returnTo=%2Fplatform%2Finterview-logs%3FmeetingId%3Dtest",
      replace: true,
    });
    expect(document.body.textContent).not.toContain("操作");
  });
  it("does not renew from background requests and blocks clicks after a suspended tab expires", async () => {
    const click = vi.fn();
    await renderGuard(click);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
    for (let index = 0; index < 3; index += 1) {
      await platformFetch("/api/platform/poll");
    }
    expect(renewMfaActivity).not.toHaveBeenCalled();
    vi.setSystemTime(start + 901_000);
    act(() => document.querySelector("button")?.click());
    expect(click).not.toHaveBeenCalled();
    expect(state.router.navigate).toHaveBeenCalledOnce();
  });
  it("checks server state on focus and redirects a revoked grant without a local error", async () => {
    await renderGuard();
    vi.mocked(fetchMfaStatus).mockResolvedValue({ enrolled: true, expiresAt: null });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(state.router.navigate).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("操作");
    expect(renewMfaActivity).not.toHaveBeenCalled();
  });
});
