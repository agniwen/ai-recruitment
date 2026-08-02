import { listAllDepartments } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { listAllInterviewers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviewers/dao";
import {
  loadJobDescriptionFilterOptions,
  loadJobDescriptionMetrics,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";

export async function loadStudioJobDescriptionsData({
  actorUserId,
  workspaceId,
}: {
  actorUserId: string;
  workspaceId: string;
}) {
  const [departments, interviewers, metrics, filterOptions] = await Promise.all([
    listAllDepartments(workspaceId, { actorUserId }),
    listAllInterviewers(workspaceId, { actorUserId }),
    loadJobDescriptionMetrics(workspaceId, { actorUserId }),
    loadJobDescriptionFilterOptions(workspaceId, { actorUserId }),
  ]);

  return {
    departments,
    interviewers,
    metrics,
    ...filterOptions,
  };
}
