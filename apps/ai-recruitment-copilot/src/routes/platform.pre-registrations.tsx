import { HydrationBoundary } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
import { createFileRoute, redirect, useLoaderData } from "@tanstack/react-router";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { parseDataGridSearchParams } from "@/components/data-grid/query-contract";
import { PlatformPreRegistrationsGrid } from "@/components/features/platform/pre-registrations/platform-pre-registrations-grid";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadPlatformPreRegistrationsState } from "@/lib/start/platform/pre-registrations.functions";
import type { PlatformPreRegistrationsState } from "@/lib/start/platform/pre-registrations.functions";

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

function PlatformPreRegistrationsRoute() {
  const state = useLoaderData({ from: "/platform/pre-registrations" });
  if (state.status !== "ready") {
    return null;
  }
  return (
    <HydrationBoundary state={state.dehydratedState as unknown as DehydratedState}>
      <div className="container mx-auto">
        <PlatformPreRegistrationsGrid />
      </div>
    </HydrationBoundary>
  );
}

export const Route = createFileRoute("/platform/pre-registrations")({
  validateSearch: (search: Record<string, unknown>) => coerceSearchParams(search),
  loader: async (loaderContext) => {
    const { location } = loaderContext as unknown as { location: { search: SearchRecord } };
    const state = (await loadPlatformPreRegistrationsState({
      data: { query: parseQuery(location.search) },
    })) as PlatformPreRegistrationsState;
    if (state.status === "unauthenticated") {
      throw redirect({ href: "/login" });
    }
    if (state.status === "forbidden") {
      throw redirect({ href: "/" });
    }
    return state;
  },
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · 预录入信息") }] }),
  component: PlatformPreRegistrationsRoute,
  shouldReload: false,
});
