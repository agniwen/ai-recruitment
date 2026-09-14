import { listAllDepartments } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { listAllInterviewers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviewers/dao";
import { listSelectableHiringUnits } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";
import {
  loadJobDescriptionFilterOptions,
  // loadJobDescriptionMetrics,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";

export async function loadStudioJobDescriptionsData({
  actorUserId,
  workspaceId,
}: {
  actorUserId: string;
  workspaceId: string;
}) {
  // 恢复统计时在 interviewers 与 filterOptions 之间恢复 metrics 解构项。
  const [departments, hiringUnits, interviewers, filterOptions] = await Promise.all([
    listAllDepartments(workspaceId, { actorUserId }),
    listSelectableHiringUnits({ actorUserId, organizationId: workspaceId }),
    listAllInterviewers(workspaceId, { actorUserId }),
    // 暂停在招岗位顶部三个图表，重新开放时恢复统计查询、metrics 返回值及页面入口。
    // loadJobDescriptionMetrics(workspaceId, { actorUserId }),
    loadJobDescriptionFilterOptions(workspaceId, { actorUserId }),
  ]);

  return {
    departments,
    hiringUnits,
    interviewers,
    // metrics,
    ...filterOptions,
  };
}
