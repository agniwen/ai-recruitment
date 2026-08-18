import { and, asc, eq } from "drizzle-orm";
import type { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  candidateFormSubmission,
  interviewAuditLog,
  studioInterviewSchedule,
} from "@arc/db-schema/schema";
import { refreshInterviewContextSnapshot } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/context-snapshots";
import { resetResumeEvaluationForJobChangeInTransaction } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/evaluation";
import type { ResumeEvaluationStatus } from "@arc/shared/studio-resumes";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const JOB_DESCRIPTION_CHANGE_PIPELINE_RESET = {
  closedAt: null,
  closedMeta: null,
  closedReason: null,
  outcome: "in_pipeline" as const,
  pipelineStage: "screening" as const,
};

export async function resetCandidateWorkflowForJobDescriptionChange(
  tx: Tx,
  input: {
    interviewRecordId: string;
    operatorId: string | null;
    organizationId: string;
  },
): Promise<{ resetAiRoundCount: number; resetFormSubmissionCount: number }> {
  const now = new Date();
  const scheduleRows = await tx
    .select({
      conversationId: studioInterviewSchedule.conversationId,
      id: studioInterviewSchedule.id,
      roundLabel: studioInterviewSchedule.roundLabel,
      sortOrder: studioInterviewSchedule.sortOrder,
      status: studioInterviewSchedule.status,
    })
    .from(studioInterviewSchedule)
    .where(
      and(
        eq(studioInterviewSchedule.interviewRecordId, input.interviewRecordId),
        eq(studioInterviewSchedule.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(studioInterviewSchedule.sortOrder), asc(studioInterviewSchedule.id));

  const deletedSubmissions = await tx
    .delete(candidateFormSubmission)
    .where(
      and(
        eq(candidateFormSubmission.interviewRecordId, input.interviewRecordId),
        eq(candidateFormSubmission.organizationId, input.organizationId),
      ),
    )
    .returning({ id: candidateFormSubmission.id });

  for (const scheduleRow of scheduleRows) {
    await tx
      .update(studioInterviewSchedule)
      .set({
        cancelReason: null,
        cancelledAt: null,
        completedAt: null,
        conversationId: null,
        disconnectedAt: null,
        liveKitParticipantIdentity: null,
        liveKitRoomName: null,
        sessionStartedAt: null,
        status: "pending",
        updatedAt: now,
      })
      .where(
        and(
          eq(studioInterviewSchedule.id, scheduleRow.id),
          eq(studioInterviewSchedule.organizationId, input.organizationId),
        ),
      );
  }

  const [firstScheduleRow] = scheduleRows;
  const refreshedSnapshot = firstScheduleRow
    ? await refreshInterviewContextSnapshot(tx, {
        createdAt: now,
        createdBy: input.operatorId,
        interviewRecordId: input.interviewRecordId,
        reason: "reset",
        scheduleEntryId: firstScheduleRow.id,
      })
    : null;

  for (const scheduleRow of scheduleRows) {
    await tx.insert(interviewAuditLog).values({
      action: "round_reset",
      createdAt: now,
      detail: {
        previousConversationId: scheduleRow.conversationId,
        previousStatus: scheduleRow.status,
        reason: "job_description_changed",
        roundLabel: scheduleRow.roundLabel,
        snapshotId: refreshedSnapshot?.id ?? null,
        snapshotVersion: refreshedSnapshot?.version ?? null,
      },
      id: crypto.randomUUID(),
      interviewRecordId: input.interviewRecordId,
      operatorId: input.operatorId,
      organizationId: input.organizationId,
      scheduleEntryId: scheduleRow.id,
    });
  }

  return {
    resetAiRoundCount: scheduleRows.length,
    resetFormSubmissionCount: deletedSubmissions.length,
  };
}

export async function applyJobDescriptionChangeEffects(
  tx: Tx,
  input: {
    interviewRecordId: string;
    nextJobDescriptionId: string | null;
    nextJobDescriptionName: string | null;
    operatorId: string | null;
    organizationId: string;
    previousEvaluationStatus: ResumeEvaluationStatus | null;
    previousJobDescriptionId: string | null;
    previousJobDescriptionName: string | null;
  },
): Promise<void> {
  await resetCandidateWorkflowForJobDescriptionChange(tx, {
    interviewRecordId: input.interviewRecordId,
    operatorId: input.operatorId,
    organizationId: input.organizationId,
  });

  if (input.previousEvaluationStatus) {
    await resetResumeEvaluationForJobChangeInTransaction(tx, {
      id: input.interviewRecordId,
      nextJobDescriptionId: input.nextJobDescriptionId,
      operatorId: input.operatorId,
      organizationId: input.organizationId,
      previousJobDescriptionId: input.previousJobDescriptionId,
      previousStatus: input.previousEvaluationStatus,
    });
  }

  await tx.insert(interviewAuditLog).values({
    action: "job_description_changed",
    createdAt: new Date(),
    detail: {
      fromJobDescriptionId: input.previousJobDescriptionId,
      fromJobDescriptionName: input.previousJobDescriptionName,
      toJobDescriptionId: input.nextJobDescriptionId,
      toJobDescriptionName: input.nextJobDescriptionName,
    },
    id: crypto.randomUUID(),
    interviewRecordId: input.interviewRecordId,
    operatorId: input.operatorId,
    organizationId: input.organizationId,
  });
}
