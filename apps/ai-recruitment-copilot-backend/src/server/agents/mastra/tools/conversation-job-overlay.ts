import { loadJobDescriptionById } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";

export async function resolveConversationJobOverlay(input: {
  actorUserId: string;
  boundJobDescriptionId: string | undefined;
  jobDescriptionId: string | null;
  jobDescriptionName: string | null;
  organizationId: string;
}): Promise<{ jobDescriptionId: string | null; jobDescriptionName: string | null }> {
  if (!input.boundJobDescriptionId) {
    return {
      jobDescriptionId: input.jobDescriptionId,
      jobDescriptionName: input.jobDescriptionName,
    };
  }
  const bound = await loadJobDescriptionById(input.organizationId, input.boundJobDescriptionId, {
    actorUserId: input.actorUserId,
  });
  if (!bound) {
    return {
      jobDescriptionId: input.jobDescriptionId,
      jobDescriptionName: input.jobDescriptionName,
    };
  }
  return {
    jobDescriptionId: bound.id,
    jobDescriptionName: bound.name,
  };
}
