// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { PlatformMfaGate } from "./platform-mfa-gate";

const state = vi.hoisted(() => ({ callbackFinished: false, verified: false }));
vi.mock("./admin-mfa-form", () => ({
  AdminMfaForm: ({ onVerified }: { onVerified: () => Promise<void> }) => (
    <button
      onClick={async () => {
        state.verified = true;
        await onVerified();
        state.callbackFinished = true;
      }}
    >
      完成绑定并继续
    </button>
  ),
}));
enableReactActEnvironment();
function Page() {
  const ready = useRouterState({
    select: (value) =>
      value.matches.some(
        ({ loaderData }) =>
          typeof loaderData === "object" &&
          loaderData !== null &&
          "status" in loaderData &&
          loaderData.status === "ready",
      ),
  });
  return ready ? <p>已进入管理后台</p> : <PlatformMfaGate />;
}
describe("platform MFA entry refresh", () => {
  it("returns from the verification page to the original meeting after verification", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    state.verified = false;
    state.callbackFinished = false;
    const root = createRootRoute({ component: Outlet });
    const verify = createRoute({
      component: () => (
        <PlatformMfaGate returnTo="/platform/interview-logs?meetingId=meeting-one" />
      ),
      getParentRoute: () => root,
      path: "/platform/verify",
    });
    const logs = createRoute({
      component: () => <p>原会议日志</p>,
      getParentRoute: () => root,
      loader: () => {
        expect(state.verified).toBe(true);
        return null;
      },
      path: "/platform/interview-logs",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/platform/verify"] }),
      routeTree: root.addChildren([verify, logs]),
    });
    await router.load();
    const rendered = await renderInAct(<RouterProvider router={router} />);
    try {
      act(() => document.querySelector("button")?.click());
      await waitForUi(() => expect(document.body.textContent).toContain("原会议日志"));
      expect(router.state.location.href).toBe("/platform/interview-logs?meetingId=meeting-one");
      expect(state.callbackFinished).toBe(true);
    } finally {
      await unmountInAct(rendered.root);
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    }
  });
  it("waits for authoritative loader refresh before completing the binding callback", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    state.verified = false;
    state.callbackFinished = false;
    const refresh = Promise.withResolvers<null>();
    const rootRoute = createRootRoute({
      component: Page,
      loader: async () => {
        if (!state.verified) {
          return { status: "mfa-required" };
        }
        await refresh.promise;
        return { status: "ready" };
      },
      pendingComponent: () => <p>正在进入后台…</p>,
    });
    const router = createRouter({
      defaultPendingMinMs: 0,
      defaultPendingMs: 0,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    await router.load();
    const rendered = await renderInAct(<RouterProvider router={router} />);
    try {
      const button = document.querySelector("button");
      if (!button) {
        throw new Error("Missing MFA entry");
      }
      act(() => button.click());
      await waitForUi(() => expect(document.body.textContent).toContain("正在进入后台…"));
      expect(state.callbackFinished).toBe(false);
      await act(async () => {
        refresh.resolve(null);
        await Promise.resolve();
      });
      await waitForUi(() => expect(document.body.textContent).toContain("已进入管理后台"));
      await waitForUi(() => expect(state.callbackFinished).toBe(true));
    } finally {
      await unmountInAct(rendered.root);
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    }
  });
});
