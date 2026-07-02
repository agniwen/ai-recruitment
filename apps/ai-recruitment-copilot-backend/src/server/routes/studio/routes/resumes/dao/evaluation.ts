import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog, jobDescription, studioInterview } from "@arc/db-schema/schema";
import type { ResumeEvaluationStatus } from "@arc/shared/studio-resumes";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ResumeEvaluationAvailableTimeSlot {
  endAt: string;
  startAt: string;
}

export type ResumeEvaluationMutationResult =
  | { status: "updated"; currentStatus: ResumeEvaluationStatus | null }
  | { status: "unchanged"; currentStatus: ResumeEvaluationStatus | null }
  | { status: "already_evaluated"; currentStatus: ResumeEvaluationStatus | null }
  | { status: "not_found" };

async function loadJobDescriptionNames(
  ids: (string | null)[],
  organizationId: string,
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => id !== null))];
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: jobDescription.id, name: jobDescription.name })
    .from(jobDescription)
    .where(
      and(eq(jobDescription.organizationId, organizationId), inArray(jobDescription.id, uniqueIds)),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function recordResumeJobDescriptionChange(input: {
  id: string;
  nextJobDescriptionId: string | null;
  operatorId: string | null;
  organizationId: string;
  previousJobDescriptionId: string | null;
}): Promise<void> {
  const jobDescriptionNames = await loadJobDescriptionNames(
    [input.previousJobDescriptionId, input.nextJobDescriptionId],
    input.organizationId,
  );
  await db.insert(interviewAuditLog).values({
    action: "resume_job_description_changed",
    createdAt: new Date(),
    detail: {
      nextJobDescriptionId: input.nextJobDescriptionId,
      nextJobDescriptionName: input.nextJobDescriptionId
        ? (jobDescriptionNames.get(input.nextJobDescriptionId) ?? null)
        : null,
      previousJobDescriptionId: input.previousJobDescriptionId,
      previousJobDescriptionName: input.previousJobDescriptionId
        ? (jobDescriptionNames.get(input.previousJobDescriptionId) ?? null)
        : null,
    },
    id: crypto.randomUUID(),
    interviewRecordId: input.id,
    operatorId: input.operatorId,
    organizationId: input.organizationId,
  });
}

async function insertEvaluationAudit(
  tx: Tx,
  input: {
    action:
      | "resume_evaluation_reset_for_job_change"
      | "resume_evaluation_submitted"
      | "resume_evaluation_updated";
    availableTimeSlots?: ResumeEvaluationAvailableTimeSlot[];
    fromStatus: ResumeEvaluationStatus | null;
    interviewRecordId: string;
    nextJobDescriptionId?: string | null;
    operatorId: string | null;
    organizationId: string;
    previousJobDescriptionId?: string | null;
    reason?: string | null;
    toStatus: ResumeEvaluationStatus | null;
  },
) {
  await tx.insert(interviewAuditLog).values({
    action: input.action,
    createdAt: new Date(),
    detail: {
      availableTimeSlots: input.availableTimeSlots ?? [],
      fromStatus: input.fromStatus,
      nextJobDescriptionId: input.nextJobDescriptionId ?? null,
      previousJobDescriptionId: input.previousJobDescriptionId ?? null,
      reason: input.reason ?? null,
      toStatus: input.toStatus,
    },
    id: crypto.randomUUID(),
    interviewRecordId: input.interviewRecordId,
    operatorId: input.operatorId,
    organizationId: input.organizationId,
  });
}

export async function submitResumeEvaluationOnce(input: {
  availableTimeSlots?: ResumeEvaluationAvailableTimeSlot[];
  id: string;
  operatorId: string | null;
  organizationId: string;
  reason: string;
  status: ResumeEvaluationStatus;
}): Promise<ResumeEvaluationMutationResult> {
  const now = new Date();
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(studioInterview)
      .set({
        resumeEvaluationStatus: input.status,
        updatedAt: now,
      })
      .where(
        and(
          eq(studioInterview.id, input.id),
          eq(studioInterview.organizationId, input.organizationId),
          isNull(studioInterview.resumeEvaluationStatus),
        ),
      )
      .returning({ id: studioInterview.id });

    if (!updated) {
      const [existing] = await tx
        .select({ resumeEvaluationStatus: studioInterview.resumeEvaluationStatus })
        .from(studioInterview)
        .where(
          and(
            eq(studioInterview.id, input.id),
            eq(studioInterview.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!existing) {
        return { status: "not_found" };
      }
      return {
        currentStatus: existing.resumeEvaluationStatus,
        status: "already_evaluated",
      };
    }

    await insertEvaluationAudit(tx, {
      action: "resume_evaluation_submitted",
      availableTimeSlots: input.availableTimeSlots,
      fromStatus: null,
      interviewRecordId: input.id,
      operatorId: input.operatorId,
      organizationId: input.organizationId,
      reason: input.reason,
      toStatus: input.status,
    });

    return { currentStatus: input.status, status: "updated" };
  });
}

export async function resetResumeEvaluationForJobChange(input: {
  id: string;
  nextJobDescriptionId: string | null;
  operatorId: string | null;
  organizationId: string;
  previousJobDescriptionId: string | null;
  previousStatus: ResumeEvaluationStatus;
}): Promise<ResumeEvaluationMutationResult> {
  const now = new Date();
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ resumeEvaluationStatus: studioInterview.resumeEvaluationStatus })
      .from(studioInterview)
      .where(
        and(
          eq(studioInterview.id, input.id),
          eq(studioInterview.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return { status: "not_found" };
    }
    if (existing.resumeEvaluationStatus === null) {
      return { currentStatus: null, status: "unchanged" };
    }

    await tx
      .update(studioInterview)
      .set({
        resumeEvaluationStatus: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(studioInterview.id, input.id),
          eq(studioInterview.organizationId, input.organizationId),
        ),
      );

    await insertEvaluationAudit(tx, {
      action: "resume_evaluation_reset_for_job_change",
      fromStatus: input.previousStatus,
      interviewRecordId: input.id,
      nextJobDescriptionId: input.nextJobDescriptionId,
      operatorId: input.operatorId,
      organizationId: input.organizationId,
      previousJobDescriptionId: input.previousJobDescriptionId,
      reason: "岗位变更后需重新评估",
      toStatus: null,
    });

    return { currentStatus: null, status: "updated" };
  });
}

export async function updateResumeEvaluationStatus(input: {
  id: string;
  operatorId: string | null;
  organizationId: string;
  status: ResumeEvaluationStatus | null;
}): Promise<ResumeEvaluationMutationResult> {
  const now = new Date();
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ resumeEvaluationStatus: studioInterview.resumeEvaluationStatus })
      .from(studioInterview)
      .where(
        and(
          eq(studioInterview.id, input.id),
          eq(studioInterview.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return { status: "not_found" };
    }
    if (existing.resumeEvaluationStatus === input.status) {
      return { currentStatus: input.status, status: "unchanged" };
    }

    await tx
      .update(studioInterview)
      .set({
        resumeEvaluationStatus: input.status,
        updatedAt: now,
      })
      .where(
        and(
          eq(studioInterview.id, input.id),
          eq(studioInterview.organizationId, input.organizationId),
        ),
      );

    await insertEvaluationAudit(tx, {
      action: "resume_evaluation_updated",
      fromStatus: existing.resumeEvaluationStatus,
      interviewRecordId: input.id,
      operatorId: input.operatorId,
      organizationId: input.organizationId,
      toStatus: input.status,
    });

    return { currentStatus: input.status, status: "updated" };
  });
}
