import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog, jobDescription, studioInterview } from "@arc/db-schema/schema";
import type { ResumeEvaluationStatus } from "@arc/shared/studio-resumes";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ResumeEvaluationAvailableTimeSlot {
  endAt: string;
  startAt: string;
}

function isResumeEvaluationTimeSlot(value: unknown): value is ResumeEvaluationAvailableTimeSlot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const slot = value as Partial<ResumeEvaluationAvailableTimeSlot>;
  return typeof slot.startAt === "string" && typeof slot.endAt === "string";
}

/** Parse evaluation-pass time slots from audit `detail.availableTimeSlots`. */
export function readResumeEvaluationTimeSlots(
  value?: unknown,
): ResumeEvaluationAvailableTimeSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isResumeEvaluationTimeSlot);
}

/**
 * 从按时间倒序的评估审计里取出「最近一次评估通过」时填写的可预约时间。
 *
 * 换岗会重置评估状态，活动记录里可能有多轮 pass/fail。候选人信息只展示
 * 最新一次 `toStatus === "pass"` 的时间段，不会回退到更早一轮通过的记录。
 * 调用方还需保证当前 `resumeEvaluationStatus === "pass"` 才展示。
 *
 * `audits` must already be sorted newest-first.
 */
export function pickLatestPassEvaluationTimeSlots(
  audits: readonly { detail: Record<string, unknown> | null | undefined }[],
): ResumeEvaluationAvailableTimeSlot[] {
  for (const audit of audits) {
    if (audit.detail?.toStatus !== "pass") {
      continue;
    }
    return readResumeEvaluationTimeSlots(audit.detail.availableTimeSlots);
  }
  return [];
}

export type ResumeEvaluationMutationResult =
  | { status: "updated"; currentStatus: ResumeEvaluationStatus | null }
  | { status: "unchanged"; currentStatus: ResumeEvaluationStatus | null }
  | { status: "already_passed"; currentStatus: "pass" }
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
  operatorRole?: string | null;
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
    operatorRole: input.operatorRole ?? null,
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
    departmentName?: string | null;
    fromStatus: ResumeEvaluationStatus | null;
    interviewRecordId: string;
    nextJobDescriptionId?: string | null;
    operatorId: string | null;
    operatorRole?: string | null;
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
      departmentName: input.departmentName ?? null,
      fromStatus: input.fromStatus,
      nextJobDescriptionId: input.nextJobDescriptionId ?? null,
      previousJobDescriptionId: input.previousJobDescriptionId ?? null,
      reason: input.reason ?? null,
      toStatus: input.toStatus,
    },
    id: crypto.randomUUID(),
    interviewRecordId: input.interviewRecordId,
    operatorId: input.operatorId,
    operatorRole: input.operatorRole ?? null,
    organizationId: input.organizationId,
  });
}

export async function submitResumeEvaluation(input: {
  availableTimeSlots?: ResumeEvaluationAvailableTimeSlot[];
  departmentName: string;
  id: string;
  operatorId: string | null;
  operatorRole?: string | null;
  organizationId: string;
  reason: string;
  status: ResumeEvaluationStatus;
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
      .limit(1)
      .for("update", { of: studioInterview });

    if (!existing) {
      return { status: "not_found" };
    }
    if (existing.resumeEvaluationStatus === "pass") {
      return { currentStatus: "pass", status: "already_passed" };
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
      action:
        existing.resumeEvaluationStatus === null
          ? "resume_evaluation_submitted"
          : "resume_evaluation_updated",
      availableTimeSlots: input.availableTimeSlots,
      departmentName: input.departmentName,
      fromStatus: existing.resumeEvaluationStatus,
      interviewRecordId: input.id,
      operatorId: input.operatorId,
      operatorRole: input.operatorRole,
      organizationId: input.organizationId,
      reason: input.reason,
      toStatus: input.status,
    });

    return { currentStatus: input.status, status: "updated" };
  });
}

export async function resetResumeEvaluationForJobChangeInTransaction(
  tx: Tx,
  input: {
    id: string;
    nextJobDescriptionId: string | null;
    operatorId: string | null;
    operatorRole?: string | null;
    organizationId: string;
    previousJobDescriptionId: string | null;
    previousStatus: ResumeEvaluationStatus;
  },
): Promise<ResumeEvaluationMutationResult> {
  const now = new Date();
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
    operatorRole: input.operatorRole,
    organizationId: input.organizationId,
    previousJobDescriptionId: input.previousJobDescriptionId,
    reason: "岗位变更后需重新评估",
    toStatus: null,
  });

  return { currentStatus: null, status: "updated" };
}

export async function resetResumeEvaluationForJobChange(input: {
  id: string;
  nextJobDescriptionId: string | null;
  operatorId: string | null;
  operatorRole?: string | null;
  organizationId: string;
  previousJobDescriptionId: string | null;
  previousStatus: ResumeEvaluationStatus;
}): Promise<ResumeEvaluationMutationResult> {
  return await db.transaction((tx) => resetResumeEvaluationForJobChangeInTransaction(tx, input));
}

interface UpdateResumeEvaluationStatusInput {
  id: string;
  operatorId: string | null;
  operatorRole?: string | null;
  organizationId: string;
  status: ResumeEvaluationStatus | null;
}

export async function updateResumeEvaluationStatusInTransaction(
  tx: Tx,
  input: UpdateResumeEvaluationStatusInput,
): Promise<ResumeEvaluationMutationResult> {
  const now = new Date();
  const [existing] = await tx
    .select({ resumeEvaluationStatus: studioInterview.resumeEvaluationStatus })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.id),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: studioInterview });

  if (!existing) {
    return { status: "not_found" };
  }
  if (existing.resumeEvaluationStatus === "pass") {
    return { currentStatus: "pass", status: "already_passed" };
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
    operatorRole: input.operatorRole,
    organizationId: input.organizationId,
    toStatus: input.status,
  });

  return { currentStatus: input.status, status: "updated" };
}

export async function updateResumeEvaluationStatus(
  input: UpdateResumeEvaluationStatusInput,
): Promise<ResumeEvaluationMutationResult> {
  return await db.transaction((tx) => updateResumeEvaluationStatusInTransaction(tx, input));
}
