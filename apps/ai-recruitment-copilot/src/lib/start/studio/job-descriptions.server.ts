import { dehydrate } from "@tanstack/react-query";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { buildDataGridQueryKey } from "@/components/data-grid/query-contract";
import type { JsonValue } from "@/lib/start/server-function-types";
import { createQueryClient } from "@arc/shared/query-client";
import { listAllDepartments } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { listAllInterviewers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviewers/dao";
import {
  listJobDescriptions,
  loadJobDescriptionMetrics,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";
import type { JobDescriptionFilters } from "./job-descriptions.functions";

export async function loadStudioJobDescriptionsData({
  actorUserId,
  query,
  slug,
  workspaceId,
}: {
  actorUserId: string;
  query: DataGridQueryState<JobDescriptionFilters>;
  slug: string;
  workspaceId: string;
}) {
  const queryClient = createQueryClient();
  const [departments, interviewers, metrics] = await Promise.all([
    listAllDepartments(workspaceId, { actorUserId }),
    listAllInterviewers(workspaceId, { actorUserId }),
    loadJobDescriptionMetrics(workspaceId, { actorUserId }),
    queryClient.prefetchQuery({
      queryFn: () =>
        listJobDescriptions(
          workspaceId,
          {
            actorUserId,
            departmentId: query.filters.departmentId,
            interviewerId: query.filters.interviewerId,
            search: query.search,
          },
          {
            page: query.page,
            pageSize: query.pageSize,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
          },
        ),
      queryKey: buildDataGridQueryKey(["job-descriptions", slug], query),
    }),
  ]);

  return {
    dehydratedState: structuredClone(dehydrate(queryClient)) as unknown as JsonValue,
    departments,
    interviewers,
    metrics,
  };
}
