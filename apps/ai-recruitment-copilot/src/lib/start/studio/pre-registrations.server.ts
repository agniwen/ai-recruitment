import { dehydrate } from "@tanstack/react-query";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { buildDataGridQueryKey } from "@/components/data-grid/query-contract";
import type { JsonValue } from "@/lib/start/server-function-types";
import { queryPaginatedStudioPreRegistrations } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/pre-registrations/dao";
import { createQueryClient } from "@arc/shared/query-client";

type EmptyFilters = Record<string, never>;

export async function loadStudioPreRegistrationsHydrationState(
  slug: string,
  query: DataGridQueryState<EmptyFilters>,
): Promise<JsonValue> {
  const queryClient = createQueryClient();
  await queryClient.prefetchQuery({
    queryFn: () =>
      queryPaginatedStudioPreRegistrations(slug, {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        sortBy:
          query.sortBy === "email" || query.sortBy === "createdAt" ? query.sortBy : "displayName",
        sortOrder: query.sortOrder ?? "asc",
      }),
    queryKey: buildDataGridQueryKey(["studio-pre-registrations", slug], query),
  });
  return structuredClone(dehydrate(queryClient)) as unknown as JsonValue;
}
