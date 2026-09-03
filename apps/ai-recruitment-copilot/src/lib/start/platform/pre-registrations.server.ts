import { dehydrate } from "@tanstack/react-query";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { buildDataGridQueryKey } from "@/components/data-grid/query-contract";
import type { JsonValue } from "@/lib/start/server-function-types";
import { queryPaginatedPlatformPreRegistrations } from "@arc/ai-recruitment-copilot-backend/server/routes/platform/routes/pre-registrations/dao";
import { createQueryClient } from "@arc/shared/query-client";

type EmptyFilters = Record<string, never>;

export async function loadPlatformPreRegistrationsHydrationState(
  query: DataGridQueryState<EmptyFilters>,
): Promise<JsonValue> {
  const queryClient = createQueryClient();
  await queryClient.prefetchQuery({
    queryFn: () =>
      queryPaginatedPlatformPreRegistrations({
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        sortBy:
          query.sortBy === "email" || query.sortBy === "createdAt" ? query.sortBy : "displayName",
        sortOrder: query.sortOrder ?? "asc",
      }),
    queryKey: buildDataGridQueryKey(["platform-pre-registrations"], query),
  });
  return structuredClone(dehydrate(queryClient)) as unknown as JsonValue;
}
