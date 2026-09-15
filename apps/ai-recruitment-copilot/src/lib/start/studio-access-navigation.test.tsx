// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import type { WorkspacePermissionStatements } from "@arc/shared/permission-statements";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { Route as StudioRoute } from "@/routes/w.$slug.studio";
import { loadStudioResumesStateFromRequest } from "@/lib/start/studio/resumes-state.server";

const accessMocks = vi.hoisted(() => ({ denied: "resource" }));

vi.mock("@/lib/start/auth-session", () => ({ getFirstAllowedStudioPagePath: vi.fn() }));
vi.mock("@/lib/start/auth-session.server", () => ({
  resolveWorkspaceAccessFromRequest: () =>
    Promise.resolve({
      member: { role: "04-odc" },
      permissions:
        accessMocks.denied === "page"
          ? { page: ["me"], resumeLibrary: ["read"] }
          : { page: ["resumes", "me"] },
      status: "ready",
      user: { id: "odc-user" },
      workspace: { id: "work-id", slug: "work" },
    }),
}));
vi.mock("@/components/features/studio/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));

enableReactActEnvironment();

describe("Studio permission denial navigation", () => {
  it.each([
    { allowed: false, label: "page only", permissions: { page: ["resumePool"] } },
    { allowed: false, label: "read only", permissions: { resumePool: ["read"] } },
    {
      allowed: true,
      label: "page and read",
      permissions: { page: ["resumePool"], resumePool: ["read"] },
    },
  ] satisfies { label: string; permissions: WorkspacePermissionStatements; allowed: boolean }[])(
    "checks resume pool direct navigation with $label permissions",
    async ({ permissions, allowed }) => {
      const root = createRootRoute();
      const workspace = createRoute({
        getParentRoute: () => root,
        loader: () => ({ permissions, status: "ready" }),
        path: "/w/$slug",
      });
      const studio = createRoute({
        getParentRoute: () => workspace,
        loader: (context) => {
          const { loader } = StudioRoute.options;
          if (typeof loader === "function") {
            return loader(context as never);
          }
        },
        path: "studio",
      });
      const pool = createRoute({ getParentRoute: () => studio, path: "resume-pool" });
      const router = createRouter({
        history: createMemoryHistory({ initialEntries: ["/w/work/studio/resume-pool"] }),
        routeTree: root.addChildren([workspace.addChildren([studio.addChildren([pool])])]),
      });
      await router.load();
      const studioMatch = router.state.matches.find((match) => match.routeId === studio.id);
      expect(studioMatch?.status).toBe(allowed ? "success" : "notFound");
    },
  );

  it.each(["page", "resource"])(
    "keeps workspace navigation when candidate %s access is denied",
    async (denied) => {
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      accessMocks.denied = denied;
      const root = createRootRoute({
        component: Outlet,
        notFoundComponent: () => <p>Application 404</p>,
      });
      const workspace = createRoute({
        component: () => (
          <>
            <nav>Workspace navigation</nav>
            <Outlet />
          </>
        ),
        getParentRoute: () => root,
        loader: () => ({
          permissions: { page: denied === "page" ? ["me"] : ["resumes", "me"] },
          status: "ready",
        }),
        path: "/w/$slug",
      });
      const studio = createRoute({
        component: Outlet,
        getParentRoute: () => workspace,
        loader: (context) => {
          const { loader } = StudioRoute.options;
          // The isolated tree supplies the same runtime inputs as the generated route tree.
          if (typeof loader === "function") {
            return loader(context as never);
          }
        },
        notFoundComponent: StudioRoute.options.notFoundComponent,
        path: "studio",
      });
      const resumes = createRoute({
        component: () => <p>Private candidate data</p>,
        getParentRoute: () => studio,
        loader: async () => {
          const state = await loadStudioResumesStateFromRequest({ slug: "work" });
          if (state.status === "not_found") {
            throw notFound();
          }
          return state;
        },
        path: "resumes",
      });
      const router = createRouter({
        defaultHashScrollIntoView: false,
        defaultNotFoundComponent: () => <p>Application 404</p>,
        history: createMemoryHistory({ initialEntries: ["/w/work/studio/resumes"] }),
        notFoundMode: "root",
        routeTree: root.addChildren([workspace.addChildren([studio.addChildren([resumes])])]),
      });
      await router.load();
      const rendered = await renderInAct(<RouterProvider router={router} />);
      try {
        expect(rendered.container.textContent).toContain("Workspace navigation");
        expect(rendered.container.textContent).not.toContain("Application 404");
        expect(rendered.container.textContent).not.toContain("Private candidate data");
        expect(rendered.container.textContent).toContain("返回工作区");
      } finally {
        await unmountInAct(rendered.root);
        vi.restoreAllMocks();
      }
    },
  );
});
