// @vitest-environment jsdom
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { enableReactActEnvironment, unmountInAct } from "@/test-utils/react-act";
import { getRouter } from "./router";

enableReactActEnvironment();

vi.mock("@/components/features/studio/resumes/resume-library-page", () => ({
  ResumeLibraryPage: () => <div data-testid="candidate-list">候选人列表</div>,
}));
vi.mock("@/components/features/studio/resumes/recruiter-resume-detail-page", () => ({
  RecruiterResumeDetailPage: ({ onBack, recordId }: { onBack: () => void; recordId: string }) => (
    <button onClick={onBack} type="button">
      返回列表 {recordId}
    </button>
  ),
  RecruiterResumeDetailSkeleton: () => <p>加载详情</p>,
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./routeTree.gen", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  const { StudioContentOverlayProvider, StudioContentOverlayTarget } =
    await import("@/components/features/studio/studio-content-route-overlay");
  const { Route: list } = await import("./routes/w.$slug.studio.resumes");
  const { Route: detail } = await import("./routes/w.$slug.studio.resumes.$recordId");
  const { Route: overlay } = await import("./routes/w.$slug.studio.resumes.overlay.$recordId");
  const root = createRootRoute({
    component: () => (
      <StudioContentOverlayProvider>
        <Outlet />
        <StudioContentOverlayTarget />
      </StudioContentOverlayProvider>
    ),
  });
  // Supply ready access data while exercising the production route components.
  list.update({
    getParentRoute: () => root,
    loader: () => ({ status: "ready" }),
    path: "/w/$slug/studio/resumes",
  } as never);
  detail.update({ getParentRoute: () => list, path: "/$recordId" } as never);
  overlay.update({ getParentRoute: () => list, path: "/overlay/$recordId" } as never);
  return { routeTree: root.addChildren([list.addChildren([detail, overlay])]) };
});

async function mountRouter(initialEntry: string) {
  const router = getRouter();
  router.update({
    context: router.options.context,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<RouterProvider router={router} />));
  return { container, root, router };
}

describe("candidate detail route masking", () => {
  it("preserves the mounted list and its scroll offset across detail, back and forward", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { router, container, root } = await mountRouter("/w/work/studio/resumes?stage=ai_review");
    try {
      const list = container.querySelector<HTMLElement>('[data-testid="candidate-list"]');
      if (!list) {
        throw new Error("Missing candidate list");
      }
      list.scrollTop = 850;
      await act(() =>
        router.navigate({
          mask: {
            params: { recordId: "candidate-1", slug: "work" },
            search: { stage: "ai_review", tab: "rounds" },
            to: "/w/$slug/studio/resumes/$recordId",
            unmaskOnReload: true,
          },
          params: { recordId: "candidate-1", slug: "work" },
          resetScroll: false,
          search: { stage: "ai_review", tab: "rounds" },
          state: { fromRecruiterResumeList: true },
          to: "/w/$slug/studio/resumes/overlay/$recordId",
        }),
      );
      expect(router.state.location.pathname).toBe("/w/work/studio/resumes/overlay/candidate-1");
      expect(router.history.location.pathname).toBe("/w/work/studio/resumes/candidate-1");
      expect(router.history.location.search).toContain("stage=ai_review");
      expect(router.history.location.search).toContain("tab=rounds");
      expect(container.querySelector('[data-testid="candidate-list"]')).toBe(list);
      expect(list.parentElement?.hasAttribute("inert")).toBe(true);
      expect(list.scrollTop).toBe(850);
      const back = container.querySelector("button");
      if (!back) {
        throw new Error("Missing detail back button");
      }
      await act(async () => {
        back.click();
        await router.load();
      });
      expect(router.state.location.pathname).toBe("/w/work/studio/resumes");
      expect(container.querySelector('[data-testid="candidate-list"]')).toBe(list);
      expect(list.parentElement?.hasAttribute("inert")).toBe(false);
      expect(list.scrollTop).toBe(850);
      await act(async () => {
        router.history.forward();
        await router.load();
      });
      expect(router.state.location.pathname).toBe("/w/work/studio/resumes/overlay/candidate-1");
      expect(container.querySelector('[data-testid="candidate-list"]')).toBe(list);
      const reloadedRouter = getRouter();
      const reloadedHistory = createMemoryHistory();
      reloadedHistory.replace(router.history.location.href, router.history.location.state);
      reloadedRouter.update({ context: reloadedRouter.options.context, history: reloadedHistory });
      await reloadedRouter.load();
      expect(reloadedRouter.state.location.pathname).toBe("/w/work/studio/resumes/candidate-1");
    } finally {
      await unmountInAct(root);
      container.remove();
      vi.restoreAllMocks();
    }
  });

  it("opens shared detail URLs standalone and returns to the filtered list", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { router, container, root } = await mountRouter(
      "/w/work/studio/resumes/candidate-1?stage=ai_review&tab=rounds",
    );
    try {
      expect(container.querySelector('[data-testid="candidate-list"]')).toBeNull();
      const back = container.querySelector("button");
      if (!back) {
        throw new Error("Missing detail back button");
      }
      await act(async () => {
        back.click();
        await router.load();
      });
      expect(router.state.location.pathname).toBe("/w/work/studio/resumes");
      expect(router.state.location.search).toMatchObject({ stage: "ai_review" });
      expect(router.state.location.search).not.toHaveProperty("tab");
      expect(container.querySelector('[data-testid="candidate-list"]')).not.toBeNull();
    } finally {
      await unmountInAct(root);
      container.remove();
      vi.restoreAllMocks();
    }
  });
});
