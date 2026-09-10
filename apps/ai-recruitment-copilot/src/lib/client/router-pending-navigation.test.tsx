// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { enableReactActEnvironment, unmountInAct } from "@/test-utils/react-act";

enableReactActEnvironment();

function createNavigationRouter() {
  const root = createRootRoute({
    component: () => (
      <main>
        <p>应用导航</p>
        <Outlet />
      </main>
    ),
  });
  const workspace = createRoute({
    component: Outlet,
    getParentRoute: () => root,
    loader: async ({ location, params }) => {
      await delay(5);
      if (location.pathname === `/w/${params.slug}/studio`) {
        throw redirect({ href: `/w/${params.slug}/studio/resumes` });
      }
    },
    path: "/w/$slug/studio",
  });
  const resumes = createRoute({
    component: () => <p>工作台内容</p>,
    getParentRoute: () => workspace,
    loader: async () => {
      await delay(5);
      return null;
    },
    path: "resumes",
    shouldReload: false,
  });
  const studio = createRoute({
    getParentRoute: () => root,
    loader: async () => {
      await delay(5);
      throw redirect({ href: "/w/work/studio" });
    },
    path: "/studio",
  });
  const platform = createRoute({
    component: Outlet,
    getParentRoute: () => root,
    loader: async ({ location }) => {
      await delay(5);
      if (location.pathname === "/platform") {
        throw redirect({ href: "/platform/organizations" });
      }
    },
    path: "/platform",
  });
  const organizations = createRoute({
    component: () => <p>管理后台内容</p>,
    getParentRoute: () => platform,
    loader: async () => {
      await delay(5);
      return null;
    },
    path: "organizations",
    shouldReload: false,
  });

  return createRouter({
    defaultPendingComponent: () => <p>正在加载</p>,
    defaultPendingMinMs: 1,
    defaultPendingMs: 1,
    history: createMemoryHistory({ initialEntries: ["/w/work/studio/resumes"] }),
    routeTree: root.addChildren([
      studio,
      workspace.addChildren([resumes]),
      platform.addChildren([organizations]),
    ]),
  });
}

describe("platform/workspace navigation", () => {
  it("keeps the app mounted when a stale pending match outlives its load, then navigates both ways", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const router = createNavigationRouter();
    await router.load();
    const container = document.createElement("div");
    document.body.append(container);
    const onUncaughtError = vi.fn();
    const root = createRoot(container, { onUncaughtError });

    try {
      await act(() => root.render(<RouterProvider router={router} />));
      expect(container.textContent).toContain("工作台内容");
      const match = router.state.matches.at(-1);
      if (!match) {
        throw new Error("Expected the loaded workspace match");
      }

      // Reproduce a stale presentation snapshot after navigation has finished.
      // The newer router waits on the transition rather than a per-match Promise.
      const completedTransition = router._tx;
      router._tx = undefined;

      // Replay the race from TanStack/router#7753 and #7910: loading has
      // settled, but React observes an older pending snapshot. Publish through
      // the router presentation store; no fake Promise
      // is injected: the installed router must keep this state renderable.
      await act(() => {
        router.stores.setMatches(
          router.state.matches.map((previous) =>
            previous.id === match.id ? { ...previous, status: "pending" } : previous,
          ),
        );
      });
      expect(onUncaughtError).not.toHaveBeenCalled();
      expect(container.textContent).toContain("应用导航");
      expect(container.textContent).toContain("正在加载");

      await act(() => {
        router.stores.setMatches(
          router.state.matches.map((previous) =>
            previous.id === match.id ? { ...previous, status: "success" } : previous,
          ),
        );
      });
      expect(container.textContent).toContain("工作台内容");

      router._tx = completedTransition;

      for (let round = 0; round < 3; round += 1) {
        await act(async () => {
          void router.navigate({ to: "/platform" });
          await delay(60);
        });
        expect(router.state.location.pathname).toBe("/platform/organizations");
        expect(container.textContent).toContain("管理后台内容");
        await act(async () => {
          void router.navigate({ to: "/studio" });
          await delay(60);
        });
        expect(router.state.location.pathname).toBe("/w/work/studio/resumes");
        expect(container.textContent).toContain("工作台内容");
      }
      expect(onUncaughtError).not.toHaveBeenCalled();
    } finally {
      await unmountInAct(root);
      container.remove();
      vi.restoreAllMocks();
    }
  });
});
