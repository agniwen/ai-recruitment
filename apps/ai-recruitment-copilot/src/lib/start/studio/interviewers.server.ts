import { listAllDepartments } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
export async function loadStudioInterviewersData({
  actorUserId,
  workspaceId,
}: {
  actorUserId: string;
  workspaceId: string;
}) {
  return {
    departments: await listAllDepartments(workspaceId, { actorUserId }),
  };
}
