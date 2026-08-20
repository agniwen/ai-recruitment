import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useSearch,
} from "@tanstack/react-router";
import {
  OdcAnalysisPage,
  OdcAnalysisPageError,
  OdcAnalysisPageSkeleton,
} from "@/components/features/studio/odc-analysis/odc-analysis-page";
import { coerceOdcAnalysisSearch, filtersFromOdcAnalysisSearch } from "@arc/shared/odc-analysis";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadOdcAnalysisState } from "@/lib/start/studio/odc-analysis.functions";

function OdcAnalysisRoute() {
  const state = useLoaderData({ from: "/w/$slug/studio/odc-analysis" });
  const search = useSearch({ from: "/w/$slug/studio/odc-analysis" });
  if (state.status !== "ready") {
    return null;
  }
  return (
    <OdcAnalysisPage
      canViewResumes={state.access.canViewResumes}
      data={state.data}
      jobs={state.jobs}
      roles={state.roles}
      search={search}
    />
  );
}

export const Route = createFileRoute("/w/$slug/studio/odc-analysis")({
  validateSearch: coerceOdcAnalysisSearch,
  loaderDeps: ({ search }) => ({
    from: search.from,
    jdIds: search.jdIds,
    role: search.role,
    to: search.to,
  }),
  loader: async ({ deps, params }) => {
    const filters = filtersFromOdcAnalysisSearch(deps);
    const state = await loadOdcAnalysisState({ data: { filters, slug: params.slug } });
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(`/w/${params.slug}/studio/odc-analysis`)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  head: () => ({ meta: [{ title: formatDocumentTitle("ODC分析") }] }),
  component: OdcAnalysisRoute,
  errorComponent: OdcAnalysisPageError,
  pendingComponent: OdcAnalysisPageSkeleton,
  staleTime: 10_000,
});
