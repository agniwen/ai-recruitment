import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  OdcAnalysisPage,
  OdcAnalysisPageError,
  OdcAnalysisPageSkeleton,
} from "@/components/features/studio/odc-analysis/odc-analysis-page";
import { coerceOdcAnalysisSearch, filtersFromOdcAnalysisSearch } from "@arc/shared/odc-analysis";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadOdcAnalysisState } from "@/lib/start/studio/odc-analysis.functions";

function filtersMatch(
  left: ReturnType<typeof filtersFromOdcAnalysisSearch>,
  right: ReturnType<typeof filtersFromOdcAnalysisSearch>,
): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.role === right.role &&
    left.jobDescriptionIds.join(",") === right.jobDescriptionIds.join(",")
  );
}

function OdcAnalysisRoute() {
  const state = useLoaderData({ from: "/w/$slug/studio/odc-analysis" });
  const search = useSearch({ from: "/w/$slug/studio/odc-analysis" });
  const { slug } = useParams({ from: "/w/$slug/studio/odc-analysis" });
  const filters = filtersFromOdcAnalysisSearch(search);
  const dataQuery = useQuery({
    initialData: filtersMatch(filters, state.data.filters) ? state.data : undefined,
    queryFn: async () => {
      const nextState = await loadOdcAnalysisState({ data: { filters, slug } });
      if (nextState.status !== "ready") {
        throw new Error("ODC 分析加载失败");
      }
      return nextState.data;
    },
    queryKey: ["odc-analysis", slug, "data", filters],
    staleTime: 10_000,
  });
  return (
    <OdcAnalysisPage
      canViewResumes={state.access.canViewResumes}
      data={dataQuery.data}
      dataError={dataQuery.isError}
      dataLoading={dataQuery.isFetching}
      jobs={state.jobs}
      onRetry={() => void dataQuery.refetch()}
      roles={state.roles}
      search={search}
    />
  );
}

export const Route = createFileRoute("/w/$slug/studio/odc-analysis")({
  validateSearch: coerceOdcAnalysisSearch,
  loader: async ({ location, params }) => {
    const filters = filtersFromOdcAnalysisSearch(coerceOdcAnalysisSearch(location.search));
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
  staleTime: Number.POSITIVE_INFINITY,
});
