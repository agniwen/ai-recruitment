import { listAllJobDescriptions } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";
export async function loadStudioInterviewQuestionsData({
  actorUserId,
  workspaceId,
}: {
  actorUserId: string;
  workspaceId: string;
}) {
  return {
    jobDescriptions: await listAllJobDescriptions(workspaceId, { actorUserId }),
  };
}
