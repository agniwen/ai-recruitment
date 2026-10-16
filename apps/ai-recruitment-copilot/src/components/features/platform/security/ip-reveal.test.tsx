// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { IpReveal } from "./ip-reveal";
import { revealIp } from "./api";
import { redirectToPlatformMfa } from "@/lib/client/platform-mfa";

vi.mock("./api", () => ({
  needsMfa: (error: unknown) => error instanceof Error && error.message === "MFA_REQUIRED",
  revealIp: vi.fn(),
}));
vi.mock("@/lib/client/platform-mfa", () => ({ redirectToPlatformMfa: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
const reference = { id: "event-one", kind: "telemetry" as const, meetingId: "meeting-one" };
beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});
function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  act(() => button.click());
}
describe("explicit IP reveal", () => {
  it("does not preload IPs and clears plaintext on hide and timeout", async () => {
    vi.mocked(revealIp).mockResolvedValue({
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      ip: "203.0.113.7",
    });
    rendered = await renderInAct(<IpReveal hasIp reference={reference} />);
    expect(revealIp).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("203.0.113.7");
    click("查看 IP");
    await waitForUi(() => expect(document.body.textContent).toContain("203.0.113.7"));
    expect(revealIp).toHaveBeenCalledWith(reference, expect.any(AbortSignal));
    click("隐藏");
    expect(document.body.textContent).not.toContain("203.0.113.7");
    vi.useFakeTimers();
    click("查看 IP");
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("203.0.113.7");
    act(() => vi.advanceTimersByTime(60_000));
    expect(document.body.textContent).not.toContain("203.0.113.7");
  });
  it("redirects expired MFA to the verification page without revealing or retrying an IP", async () => {
    vi.mocked(revealIp).mockRejectedValue(new Error("MFA_REQUIRED"));
    rendered = await renderInAct(<IpReveal hasIp reference={reference} />);
    click("查看 IP");
    await waitForUi(() => expect(redirectToPlatformMfa).toHaveBeenCalledOnce());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(revealIp).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("完成两步验证");
  });
  it("aborts pending decryption when leaving the page", async () => {
    vi.mocked(revealIp).mockReturnValue(Promise.withResolvers<never>().promise);
    rendered = await renderInAct(<IpReveal hasIp reference={reference} />);
    click("查看 IP");
    const [[, signal]] = vi.mocked(revealIp).mock.calls;
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(signal.aborted).toBe(true);
  });
});
