import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog, studioInterview } from "@arc/db-schema/schema";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { canApproveCandidateAiReview } from "../../../interviews/dao/ai-review-approval";

export async function rejectCandidateAiReview(input: {
  candidateId: string;
  organizationId: string;
  operatorId: string;
  operatorRole?: string | null;
  approvalNote?: string;
}) {
  const result = await db.transaction(async (tx) => {
    if (
      !(await canApproveCandidateAiReview(
        { organizationId: input.organizationId, userId: input.operatorId },
        tx,
      ))
    ) {
      return { kind: "forbidden" } as const;
    }
    const [record] = await tx
      .select({
        aiReviewApprovalStatus: studioInterview.aiReviewApprovalStatus,
        pipelineStage: studioInterview.pipelineStage,
        resumeReviewStatus: studioInterview.resumeReviewStatus,
      })
      .from(studioInterview)
      .where(
        and(
          eq(studioInterview.id, input.candidateId),
          eq(studioInterview.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!record || record.pipelineStage !== "ai_review") {
      return { kind: "not_found" } as const;
    }
    if (record.resumeReviewStatus !== "ready") {
      return { kind: "invalid", message: "请等待 AI 评价生成完成后再审批。" } as const;
    }
    if (record.aiReviewApprovalStatus === "rejected") {
      return { kind: "ok" } as const;
    }
    const now = new Date();
    await tx
      .update(studioInterview)
      .set({ aiReviewApprovalStatus: "rejected", updatedAt: now })
      .where(eq(studioInterview.id, input.candidateId));
    await tx.insert(interviewAuditLog).values({
      action: "candidate_transition",
      createdAt: now,
      detail: {
        approvalDecision: "rejected",
        fromOutcome: "in_pipeline",
        fromStage: "ai_review",
        reason: input.approvalNote?.trim() || null,
        toOutcome: "in_pipeline",
        toStage: "ai_review",
      },
      id: crypto.randomUUID(),
      interviewRecordId: input.candidateId,
      operatorId: input.operatorId,
      operatorRole: input.operatorRole ?? null,
      organizationId: input.organizationId,
      source: "manual",
    });
    return { kind: "ok" } as const;
  });
  if (result.kind === "ok") {
    invalidateStudioInterviewCaches(input.organizationId);
  }
  return result;
}
