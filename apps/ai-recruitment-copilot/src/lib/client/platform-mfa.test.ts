// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformMfaHref, platformMfaReturnTo } from "@arc/shared/platform-security";
import { installPlatformMfaGuard, platformFetch } from "./platform-mfa";
import { rpc } from "./rpc";
import { apiFetch } from "./api/client";
import { rpcFetch } from "./api/rpc-fetch";
import { authClient } from "./auth-client";

vi.mock("@/env/client", () => ({ env: { NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000" } }));

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
describe("platform MFA request boundary", () => {
  it("redirects rejected Better Auth administrator operations", async () => {
    window.history.replaceState(null, "", "/platform/users");
    const redirect = vi.fn();
    cleanup = installPlatformMfaGuard({ check: () => true, redirect });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: "MFA_REQUIRED", message: "请先完成两步验证。" }, { status: 403 }),
        ),
    );
    const result = await authClient.admin.unbanUser({ userId: "user" });
    expect(result.error?.code).toBe("MFA_REQUIRED");
    expect(redirect).toHaveBeenCalledOnce();
  });
  it.each(["rpc", "binary"])(
    "redirects rejected %s requests and preserves the response error",
    async (kind) => {
      window.history.replaceState(null, "", "/platform/interview-logs?meetingId=meeting");
      const redirect = vi.fn();
      cleanup = installPlatformMfaGuard({ check: () => true, redirect });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ code: "MFA_REQUIRED", message: "请先完成两步验证。" }, { status: 403 }),
          ),
      );
      const request =
        kind === "rpc"
          ? rpcFetch(rpc.api.platform["interview-logs"].$get({ query: {} }), "失败")
          : apiFetch("/api/platform/content", { decode: "raw" });
      await expect(request).rejects.toMatchObject({
        payload: { code: "MFA_REQUIRED" },
        status: 403,
      });
      expect(redirect).toHaveBeenCalledTimes(1);
    },
  );
  it("blocks a request before sending when the local grant has expired", async () => {
    window.history.replaceState(null, "", "/platform/users");
    const redirect = vi.fn();
    cleanup = installPlatformMfaGuard({ check: () => false, redirect });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(platformFetch("/api/platform/users", { method: "POST" })).rejects.toMatchObject({
      payload: { code: "MFA_REQUIRED" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledOnce();
  });
  it("does not redirect ordinary permission failures or loop on the verification page", async () => {
    const redirect = vi.fn();
    cleanup = installPlatformMfaGuard({ check: () => true, redirect });
    window.history.replaceState(null, "", "/platform/users");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: "FORBIDDEN" }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ code: "MFA_REQUIRED" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await platformFetch("/api/platform/users");
    window.history.replaceState(null, "", "/platform/verify");
    await platformFetch("/api/security/mfa/verify", { method: "POST" });
    expect(redirect).not.toHaveBeenCalled();
  });
  it("preserves an internal return URL and rejects external or recursive targets", () => {
    const target = "/platform/interview-logs?meetingId=meeting#events";
    expect(
      new URL(platformMfaHref(target), window.location.origin).searchParams.get("returnTo"),
    ).toBe(target);
    for (const invalid of [
      "https://evil.test",
      "//evil.test/platform",
      "//[",
      "/platform/../login",
      "/platform/verify?returnTo=x",
      "/platform/verify/",
      "/\\evil.test/platform",
      null,
    ]) {
      expect(platformMfaReturnTo(invalid)).toBe("/platform/organizations");
    }
  });
});
