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
import { StudioPreRegistrationsGrid } from "@/components/features/studio/pre-registrations/studio-pre-registrations-grid";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadStudioPreRegistrationsState } from "@/lib/start/studio/pre-registrations.functions";
import type { StudioPreRegistrationsState } from "@/lib/start/studio/pre-registrations.functions";

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
    allowedSortIds: ["displayName", "email", "createdAt"],
    defaultPageSize: 20,
    defaultSorting: [{ desc: false, id: "displayName" }],
    initialFilters: {},
  });
}

function StudioPreRegistrationsRoute() {
  const { slug } = useParams({ from: "/w/$slug/studio/pre-registrations" });
  const state = useLoaderData({ from: "/w/$slug/studio/pre-registrations" });
  if (state.status !== "ready") {
    return null;
  }
  return (
    <HydrationBoundary state={state.dehydratedState as unknown as DehydratedState}>
      <div className="container mx-auto">
        <StudioPreRegistrationsGrid key={slug} />
      </div>
    </HydrationBoundary>
  );
}

export const Route = createFileRoute("/w/$slug/studio/pre-registrations")({
  validateSearch: (search: Record<string, unknown>) => coerceSearchParams(search),
  loader: async (loaderContext) => {
    const { location } = loaderContext as unknown as { location: { search: SearchRecord } };
    const state = (await loadStudioPreRegistrationsState({
      data: { slug: loaderContext.params.slug, query: parseQuery(location.search) },
    })) as StudioPreRegistrationsState;
    if (state.status === "unauthenticated") {
      throw redirect({ href: "/login" });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  head: () => ({ meta: [{ title: formatDocumentTitle("预录入信息") }] }),
  component: StudioPreRegistrationsRoute,
  shouldReload: false,
});
