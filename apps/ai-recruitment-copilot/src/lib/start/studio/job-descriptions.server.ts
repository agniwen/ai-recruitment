import { listAllDepartments } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { listAllInterviewers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviewers/dao";
import { listSelectableHiringUnits } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";
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
  const [departments, hiringUnits, interviewers, metrics, filterOptions] = await Promise.all([
    listAllDepartments(workspaceId, { actorUserId }),
    listSelectableHiringUnits({ actorUserId, organizationId: workspaceId }),
    listAllInterviewers(workspaceId, { actorUserId }),
    loadJobDescriptionMetrics(workspaceId, { actorUserId }),
    loadJobDescriptionFilterOptions(workspaceId, { actorUserId }),
  ]);

  return {
    departments,
    hiringUnits,
    interviewers,
    metrics,
    ...filterOptions,
  };
}
