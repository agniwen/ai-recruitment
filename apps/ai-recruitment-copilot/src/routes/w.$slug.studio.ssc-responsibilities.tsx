import { HydrationBoundary } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useParams,
} from "@tanstack/react-router";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { parseDataGridSearchParams } from "@/components/data-grid/query-contract";
import { SscResponsibilitiesGrid } from "@/components/features/studio/ssc-responsibilities/ssc-responsibilities-grid";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadStudioSscResponsibilitiesState } from "@/lib/start/studio/ssc-responsibilities.functions";
import type { StudioSscResponsibilitiesState } from "@/lib/start/studio/ssc-responsibilities.functions";

type EmptyFilters = Record<string, never>;
type SearchPrimitive = boolean | number | string;
type SearchRecord = Record<string, SearchPrimitive | SearchPrimitive[] | undefined>;

function coerceSearchParams(search: Record<string, unknown>): SearchRecord {
  const out: SearchRecord = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (item): item is SearchPrimitive =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
    }
  }
  return out;
}

function parseQuery(search: SearchRecord): DataGridQueryState<EmptyFilters> {
  return parseDataGridSearchParams(search, {
    allowedSortIds: ["centerName", "sscName", "email", "createdAt"],
    defaultPageSize: 20,
    defaultSorting: [{ desc: false, id: "centerName" }],
    initialFilters: {},
  });
}

function StudioSscResponsibilitiesRoute() {
  const { slug } = useParams({ from: "/w/$slug/studio/ssc-responsibilities" });
  const state = useLoaderData({ from: "/w/$slug/studio/ssc-responsibilities" });
  if (state.status !== "ready") {
    return null;
  }
  return (
    <HydrationBoundary state={state.dehydratedState as unknown as DehydratedState}>
      <div className="container mx-auto">
        <SscResponsibilitiesGrid key={slug} />
      </div>
    </HydrationBoundary>
  );
}

export const Route = createFileRoute("/w/$slug/studio/ssc-responsibilities")({
  validateSearch: (search: Record<string, unknown>) => coerceSearchParams(search),
  loader: async (loaderContext) => {
    const { location } = loaderContext as unknown as { location: { search: SearchRecord } };
    const state = (await loadStudioSscResponsibilitiesState({
      data: { slug: loaderContext.params.slug, query: parseQuery(location.search) },
    })) as StudioSscResponsibilitiesState;
    if (state.status === "unauthenticated") {
      throw redirect({ href: "/login" });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  head: () => ({ meta: [{ title: formatDocumentTitle("SSC 负责组织") }] }),
  component: StudioSscResponsibilitiesRoute,
  shouldReload: false,
});
