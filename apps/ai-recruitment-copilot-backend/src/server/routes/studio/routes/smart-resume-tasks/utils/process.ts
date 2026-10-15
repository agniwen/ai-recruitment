import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { serializeErrorDetails } from "@arc/ai-recruitment-copilot-backend/lib/server/error-reporting";
import {
  member,
  resumePoolItem,
  resumeUploadBatchItem,
  smartResumeTask,
  smartResumeTaskItem,
} from "@arc/db-schema/schema";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";

export async function loadParsedSmartResumePoolItemId(itemId: string, target: string) {
  if (target !== "resume_pool") {
    return null;
  }
  const [row] = await db
    .select({ id: resumePoolItem.id })
    .from(smartResumeTaskItem)
    .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
    .innerJoin(resumePoolItem, eq(resumePoolItem.id, resumeUploadBatchItem.poolItemId))
    .where(
      and(
        eq(smartResumeTaskItem.id, itemId),
        isNotNull(resumePoolItem.resumeProfile),
        isNotNull(resumePoolItem.resumeParsedAt),
      ),
    );
  if (row) {
    // Claim/recovery may set the parse status back to processing/queued; the successfully parsed facts remain reusable.
    await db
      .update(resumePoolItem)
      .set({ resumeParseError: null, resumeParseStatus: "ready" })
      .where(eq(resumePoolItem.id, row.id));
  }
  return row?.id ?? null;
}

// Called inside the durable parse worker. Recommendation failure does not change parse success.
export async function processSmartResumeRecommendation(itemId: string) {
  const [row] = await db
    .select({ item: smartResumeTaskItem, pool: resumePoolItem, task: smartResumeTask })
    .from(smartResumeTaskItem)
    .innerJoin(smartResumeTask, eq(smartResumeTask.id, smartResumeTaskItem.taskId))
    .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
    .innerJoin(resumePoolItem, eq(resumePoolItem.id, resumeUploadBatchItem.poolItemId))
    .where(eq(smartResumeTaskItem.id, itemId));
  if (!row || row.task.submittedAt || row.item.status === "ready") {
    return;
  }
  await db
    .update(smartResumeTaskItem)
    .set({ error: null, status: "processing" })
    .where(eq(smartResumeTaskItem.id, itemId));
  try {
    const [workspaceMember] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.organizationId, row.task.organizationId),
          eq(member.userId, row.task.createdBy),
        ),
      );
    const authorize = createRequestWorkspaceAuthorizer({
      memberRole: workspaceMember?.role,
      organizationId: row.task.organizationId,
      userId: row.task.createdBy,
    });
    if (!(await authorize({ action: "create", resource: "resumeLibrary" }))) {
      throw new Error("当前账号已无候选人创建权限，请联系管理员。");
    }
    if (!row.pool.resumeProfile || row.pool.resumeParseStatus !== "ready") {
      throw new Error("简历尚未解析完成。");
    }
    const { recommendSmartJobs } = await import("./recommend");
    const result = await recommendSmartJobs(
      row.pool.resumeProfile,
      row.task.organizationId,
      row.task.createdBy,
    );
    const [first] = result.recommendations;
    const selected =
      first &&
      first.score >= 0.5 &&
      first.warnings.length === 0 &&
      first.evidence.some(
        (evidence) =>
          evidence.field.startsWith("workExperiences.") ||
          evidence.field.startsWith("projectExperiences."),
      )
        ? [first.jobDescriptionId]
        : [];
    await db
      .update(smartResumeTaskItem)
      .set({
        error: null,
        result,
        selectedJobIds: sql`case when ${smartResumeTaskItem.selectionTouched} then ${smartResumeTaskItem.selectedJobIds} else ${JSON.stringify(selected)}::jsonb end`,
        status: "ready",
      })
      .where(eq(smartResumeTaskItem.id, itemId));
  } catch (error) {
    console.warn("[smart-resume-upload] recommendation failed", {
      errorDetails: serializeErrorDetails(error).chain.map(({ code, message, name, status }) => ({
        code,
        message,
        name,
        status,
      })),
      errorType: error instanceof Error ? error.name : "Unknown",
      itemId,
    });
    await db
      .update(smartResumeTaskItem)
      .set({ error: "岗位推荐未完成，可重试；已解析的简历会继续复用。", status: "failed" })
      .where(eq(smartResumeTaskItem.id, itemId));
  }
}
