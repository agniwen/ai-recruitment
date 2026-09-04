import { HydrationBoundary } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect, useLoaderData } from "@tanstack/react-router";
import { HiringUnitManagementPage } from "@/components/features/studio/hiring-units/hiring-unit-management-page";
import { StudioTablePageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadStudioHiringUnitsState } from "@/lib/start/studio/hiring-units.functions";
import type { StudioHiringUnitsState } from "@/lib/start/studio/hiring-units.functions";

function StudioHiringUnitsRoute() {
  const state = useLoaderData({
    from: "/w/$slug/studio/hiring-units",
  }) as unknown as StudioHiringUnitsState;
  if (state.status !== "ready") {
    return null;
  }
  return (
    <HydrationBoundary state={state.dehydratedState as unknown as DehydratedState}>
      <HiringUnitManagementPage />
    </HydrationBoundary>
  );
}

export const Route = createFileRoute("/w/$slug/studio/hiring-units")({
  component: StudioHiringUnitsRoute,
  head: () => ({ meta: [{ title: formatDocumentTitle("用人组织") }] }),
  loader: async ({ params }) => {
    const state = await loadStudioHiringUnitsState({ data: { slug: params.slug } });
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(`/w/${params.slug}/studio/hiring-units`)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  pendingComponent: () => <StudioTablePageSkeleton label="用人组织" />,
  shouldReload: false,
});
