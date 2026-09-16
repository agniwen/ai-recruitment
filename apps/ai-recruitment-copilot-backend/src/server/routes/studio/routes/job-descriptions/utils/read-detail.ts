import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { studioInterview } from "@arc/db-schema/schema";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { loadJobDescriptionById } from "../dao";

// 仅详情读取可借用 AI 审批权限；不扩大岗位列表、编辑或删除的范围。
export async function loadJobDescriptionForReader(input: {
  organizationId: string;
  jobDescriptionId: string;
  userId: string | null | undefined;
  memberRole: string | null | undefined;
}) {
  if (!input.userId) {
    return null;
  }
  const authorize = createRequestWorkspaceAuthorizer(input);
  if (await authorize({ action: "read", resource: "jd" })) {
    const scoped = await loadJobDescriptionById(input.organizationId, input.jobDescriptionId, {
      actorUserId: input.userId,
    });
    if (scoped) {
      return scoped;
    }
  }
  if (!(await authorize({ action: "approve", resource: "aiReview" }))) {
    return null;
  }
  const [pendingCandidate] = await db
    .select({ id: studioInterview.id })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.organizationId, input.organizationId),
        eq(studioInterview.jobDescriptionId, input.jobDescriptionId),
        eq(studioInterview.pipelineStage, "ai_review"),
      ),
    )
    .limit(1);
  if (!pendingCandidate) {
    return null;
  }
  // 已确认同工作区存在待审核候选人，仅本次详情读取绕过岗位来源范围。
  return loadJobDescriptionById(input.organizationId, input.jobDescriptionId);
}
