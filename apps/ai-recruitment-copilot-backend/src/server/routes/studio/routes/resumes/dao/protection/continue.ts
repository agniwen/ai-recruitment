import { and, eq, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog, studioInterview } from "@arc/db-schema/schema";
import { recordCandidateActivityInTransaction } from "../../../interviews/utils/candidate-activity";
import { admitResumeRecord, findResumeProtectionConflict, identityForResume } from "./index";

export class ResumeProtectionContinuationError extends Error {
  readonly status: 403 | 404 | 409;
  constructor(message: string, status: 403 | 404 | 409) {
    super(message);
    this.name = "ResumeProtectionContinuationError";
    this.status = status;
  }
}

export async function continueProtectedResume(input: {
  jobDescriptionId: string;
  memberRole: string | null | undefined;
  organizationId: string;
  recordId: string;
  userId: string;
}) {
  // oxlint-disable-next-line complexity -- Authorization, admission and confirmation audit must remain in one locked transaction.
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`resume-protection:${input.organizationId}`}, 0))`,
    );
    const where = and(
      eq(studioInterview.id, input.recordId),
      eq(studioInterview.organizationId, input.organizationId),
    );
    const [row] = await tx.select().from(studioInterview).where(where).limit(1);
    if (!row) {
      throw new ResumeProtectionContinuationError("候选人记录不存在。", 404);
    }
    if (
      row.createdBy !== input.userId &&
      input.memberRole !== "owner" &&
      input.memberRole !== "admin"
    ) {
      throw new ResumeProtectionContinuationError("仅本次上传人或工作区管理员可继续推荐。", 403);
    }
    if (row.pipelineStage === "closed" || row.outcome !== "in_pipeline") {
      throw new ResumeProtectionContinuationError("已结案候选人不能继续推荐。", 409);
    }
    if (row.resumeParseStatus !== "ready" || !row.resumeProfile) {
      throw new ResumeProtectionContinuationError("候选人资料尚未就绪，请稍后重试。", 409);
    }
    if (row.jobDescriptionId !== input.jobDescriptionId) {
      throw new ResumeProtectionContinuationError("关联岗位已变更，请刷新后重试。", 409);
    }
    if (row.resumeAdmissionStatus === "accepted") {
      const [confirmation] = await tx
        .select({ id: interviewAuditLog.id })
        .from(interviewAuditLog)
        .where(
          and(
            eq(interviewAuditLog.organizationId, input.organizationId),
            eq(interviewAuditLog.interviewRecordId, row.id),
            eq(interviewAuditLog.action, "resume_protection_continued"),
          ),
        )
        .limit(1);
      if (!confirmation) {
        throw new ResumeProtectionContinuationError("该记录无需继续推荐，请刷新后查看。", 409);
      }
      return {
        jobDescriptionId: row.jobDescriptionId,
        needsAnalysis: !["queued", "processing", "ready"].includes(row.resumeReviewStatus),
      };
    }
    if (row.resumeAdmissionStatus !== "protected" || !row.resumeProtection || !row.createdBy) {
      throw new ResumeProtectionContinuationError("该记录无需继续推荐，请刷新后查看。", 409);
    }
    const previousProtection = row.resumeProtection;
    const protection = await findResumeProtectionConflict(
      {
        identity: identityForResume(row),
        organizationId: input.organizationId,
        userId: row.createdBy,
      },
      tx,
    );
    const now = new Date();
    await tx
      .update(studioInterview)
      .set({
        pipelineStage: "ai_review",
        resumeAdmissionCheckedAt: now,
        resumeAdmissionStatus: protection ? "accepted" : "pending",
        // This confirmation applies only to this upload. The owner's cycle and
        // recommendation snapshots remain untouched, including their expiry.
        resumeProtection: protection,
        resumeProtectionCycleId: protection?.cycleId ?? null,
        updatedAt: now,
      })
      .where(where);
    if (!protection) {
      await admitResumeRecord(tx, row.id, input.organizationId);
    }
    await recordCandidateActivityInTransaction(tx, {
      action: "resume_protection_continued",
      detail: {
        cycleId: protection?.cycleId ?? previousProtection.cycleId,
        jobDescriptionId: input.jobDescriptionId,
        protectionExpiresAt: protection?.expiresAt ?? previousProtection.expiresAt,
        protectionOwnerUserId: protection?.ownerUserId ?? previousProtection.ownerUserId,
      },
      interviewRecordId: row.id,
      operatorId: input.userId,
      operatorRole: input.memberRole,
      organizationId: input.organizationId,
    });
    return { jobDescriptionId: input.jobDescriptionId, needsAnalysis: true };
  });
}
