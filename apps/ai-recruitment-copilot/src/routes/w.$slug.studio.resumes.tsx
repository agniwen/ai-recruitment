import {
  Outlet,
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useRouterState,
} from "@tanstack/react-router";
import { formatDocumentTitle } from "@/lib/start/document-title";
import type { StudioResumesState } from "@/lib/start/studio/resumes.functions";

import { ResumeLibraryPage } from "@/components/features/studio/resumes/resume-library-page";
import { coerceSearchParams } from "@/components/features/studio/resumes/resume-library-search";
function StudioResumesRoute() {
  const state = useLoaderData({
    from: "/w/$slug/studio/resumes",
  }) as unknown as StudioResumesState;
  const activeRouteId = useRouterState({
    select: (routerState) => routerState.matches.at(-1)?.routeId,
  });
  const isListRoute = activeRouteId === "/w/$slug/studio/resumes";
  const isOverlayRoute = activeRouteId === "/w/$slug/studio/resumes/overlay/$recordId";

  if (state.status !== "ready") {
    return null;
  }

  return (
    <>
      {isListRoute || isOverlayRoute ? (
        <div
          className="contents"
          aria-hidden={isOverlayRoute ? true : undefined}
          inert={isOverlayRoute ? true : undefined}
        >
          <ResumeLibraryPage />
        </div>
      ) : null}
      {isListRoute ? null : <Outlet />}
    </>
  );
}

export const Route = createFileRoute("/w/$slug/studio/resumes")({
  validateSearch: (search: Record<string, unknown>) => coerceSearchParams(search),
  loader: async (loaderContext) => {
    const { params } = loaderContext as unknown as { params: { slug: string } };
    const { loadStudioResumesState } = await import("@/lib/start/studio/resumes.functions");
    const state = (await loadStudioResumesState({
      data: { slug: params.slug },
    })) as StudioResumesState;
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(`/w/${params.slug}/studio/resumes`)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  head: () => ({
    meta: [{ title: formatDocumentTitle("候选人管理") }],
  }),
  component: StudioResumesRoute,
  shouldReload: false,
});
