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
import type { OdcAnalysisFilters } from "@arc/shared/odc-analysis";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadOdcAnalysisState } from "@/lib/start/studio/odc-analysis.functions";

function demandFilterKey(filters: OdcAnalysisFilters) {
  return {
    dateField: filters.demandDateField,
    from: filters.demandFrom ?? null,
    to: filters.demandTo ?? null,
  };
}

function progressFilterKey(filters: OdcAnalysisFilters) {
  return {
    from: filters.progressFrom ?? null,
    jobDescriptionIds: filters.progressJobDescriptionIds,
    to: filters.progressTo ?? null,
  };
}

function activityFilterKey(filters: OdcAnalysisFilters) {
  return {
    date: filters.activityDate ?? null,
    jobDescriptionIds: filters.activityJobDescriptionIds,
  };
}

function keysMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function demandOnlyFilters(filters: OdcAnalysisFilters): OdcAnalysisFilters {
  return {
    activityJobDescriptionIds: [],
    demandDateField: filters.demandDateField,
    demandFrom: filters.demandFrom,
    demandTo: filters.demandTo,
    progressJobDescriptionIds: [],
  };
}

function progressOnlyFilters(filters: OdcAnalysisFilters): OdcAnalysisFilters {
  return {
    activityJobDescriptionIds: [],
    demandDateField: "requestedDate",
    progressFrom: filters.progressFrom,
    progressJobDescriptionIds: filters.progressJobDescriptionIds,
    progressTo: filters.progressTo,
  };
}

function activityOnlyFilters(filters: OdcAnalysisFilters): OdcAnalysisFilters {
  return {
    activityDate: filters.activityDate,
    activityJobDescriptionIds: filters.activityJobDescriptionIds,
    demandDateField: "requestedDate",
    progressJobDescriptionIds: [],
  };
}

async function loadReadyData(slug: string, filters: OdcAnalysisFilters) {
  const nextState = await loadOdcAnalysisState({ data: { filters, slug } });
  if (nextState.status !== "ready") {
    throw new Error("ODC 分析加载失败");
  }
  return nextState.data;
}

function OdcAnalysisRoute() {
  const state = useLoaderData({ from: "/w/$slug/studio/odc-analysis" });
  const search = useSearch({ from: "/w/$slug/studio/odc-analysis" });
  const { slug } = useParams({ from: "/w/$slug/studio/odc-analysis" });
  const filters = filtersFromOdcAnalysisSearch(search);
  const initialFilters = state.data.filters;
  const demandKey = demandFilterKey(filters);
  const progressKey = progressFilterKey(filters);
  const activityKey = activityFilterKey(filters);
  const demandQuery = useQuery({
    initialData: keysMatch(demandKey, demandFilterKey(initialFilters))
      ? state.data.demand
      : undefined,
    queryFn: async () => {
      const data = await loadReadyData(slug, demandOnlyFilters(filters));
      return data.demand;
    },
    queryKey: ["odc-analysis", slug, "demand", demandKey],
    staleTime: 10_000,
  });
  const overallQuery = useQuery({
    initialData: keysMatch(progressKey, progressFilterKey(initialFilters))
      ? state.data.overall
      : undefined,
    queryFn: async () => {
      const data = await loadReadyData(slug, progressOnlyFilters(filters));
      return data.overall;
    },
    queryKey: ["odc-analysis", slug, "overall", progressKey],
    staleTime: 10_000,
  });
  const activityQuery = useQuery({
    initialData: keysMatch(activityKey, activityFilterKey(initialFilters))
      ? {
          activity: state.data.activity,
          activityInterviewStates: state.data.activityInterviewStates,
          upcoming: state.data.upcoming,
        }
      : undefined,
    queryFn: async () => {
      const data = await loadReadyData(slug, activityOnlyFilters(filters));
      return {
        activity: data.activity,
        activityInterviewStates: data.activityInterviewStates,
        upcoming: data.upcoming,
      };
    },
    queryKey: ["odc-analysis", slug, "activity", activityKey],
    staleTime: 10_000,
  });
  return (
    <OdcAnalysisPage
      activityQuery={{
        data: activityQuery.data,
        error: activityQuery.isError,
        loading: activityQuery.isPending,
        retry: () => void activityQuery.refetch(),
      }}
      canViewJobDescriptions={state.access.canViewJobDescriptions}
      canViewResumes={state.access.canViewResumes}
      demandQuery={{
        data: demandQuery.data,
        error: demandQuery.isError,
        loading: demandQuery.isPending,
        retry: () => void demandQuery.refetch(),
      }}
      jobs={state.jobs}
      overallQuery={{
        data: overallQuery.data,
        error: overallQuery.isError,
        loading: overallQuery.isPending,
        retry: () => void overallQuery.refetch(),
      }}
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
