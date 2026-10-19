import { dehydrate } from "@tanstack/react-query";
import {
  loadSscResponsibilityAdministrator,
  queryPaginatedSscResponsibilities,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/ssc-responsibilities/dao";
import { createQueryClient } from "@arc/shared/query-client";
import { buildDataGridQueryKey } from "@/components/data-grid/query-contract";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import type { JsonValue } from "@/lib/start/server-function-types";

export async function hasSscResponsibilityAdministratorAccess(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  return (await loadSscResponsibilityAdministrator(organizationId, userId)) !== null;
}

export async function loadStudioSscResponsibilitiesHydrationState(
  organizationId: string,
  slug: string,
  query: DataGridQueryState<Record<string, never>>,
): Promise<JsonValue> {
  const queryClient = createQueryClient();
  await queryClient.prefetchQuery({
    queryFn: () =>
      queryPaginatedSscResponsibilities(organizationId, {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        sortBy:
          query.sortBy === "sscName" || query.sortBy === "email" || query.sortBy === "createdAt"
            ? query.sortBy
            : "centerName",
        sortOrder: query.sortOrder ?? "asc",
      }),
    queryKey: buildDataGridQueryKey(["studio-ssc-responsibilities", slug], {
      ...query,
      filters: { textFilters: "" },
    }),
  });
  return structuredClone(dehydrate(queryClient)) as unknown as JsonValue;
}
