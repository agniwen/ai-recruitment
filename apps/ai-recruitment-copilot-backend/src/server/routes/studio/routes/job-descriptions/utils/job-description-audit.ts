import { and, eq } from "drizzle-orm";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { jobDescription, jobDescriptionAuditLog } from "@arc/db-schema/schema";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface JobDescriptionAuditChange {
  after: unknown;
  before: unknown;
}

function auditValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === undefined) {
    return null;
  }
  return value;
}

function auditValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(auditValue(left)) === JSON.stringify(auditValue(right));
}

export function buildJobDescriptionAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[] = Object.keys(after),
): Record<string, JobDescriptionAuditChange> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const beforeValue = before[field];
      const afterValue = after[field];
      return auditValuesEqual(beforeValue, afterValue)
        ? []
        : [[field, { after: auditValue(afterValue), before: auditValue(beforeValue) }]];
    }),
  );
}

export function resolveJobDescriptionStaffing(input: {
  headcount: number | null;
  onboardedCount: number | null;
}) {
  const normalizedOnboardedCount = input.onboardedCount ?? 0;
  const headcountBelowOnboarded =
    input.headcount !== null && input.headcount < normalizedOnboardedCount;
  return {
    gapCount:
      input.headcount === null ? null : Math.max(input.headcount - normalizedOnboardedCount, 0),
    headcountBelowOnboarded,
    onboardedCount: normalizedOnboardedCount,
  };
}

export async function recordJobDescriptionAudit(
  tx: DatabaseTransaction,
  input: {
    action: string;
    candidateId?: string | null;
    changes: Record<string, JobDescriptionAuditChange>;
    createdAt: Date;
    detail?: Record<string, unknown>;
    jobCode: string | null;
    jobDescriptionId: string;
    jobName: string;
    operatorId: string | null;
    operatorRole?: string | null;
    organizationId: string;
    source: string;
  },
) {
  if (Object.keys(input.changes).length === 0) {
    return;
  }
  await tx.insert(jobDescriptionAuditLog).values({
    action: input.action,
    candidateId: input.candidateId ?? null,
    createdAt: input.createdAt,
    detail: { changes: input.changes, ...input.detail },
    id: crypto.randomUUID(),
    jobCode: input.jobCode,
    jobDescriptionId: input.jobDescriptionId,
    jobName: input.jobName,
    operatorId: input.operatorId,
    operatorRole: input.operatorRole ?? null,
    organizationId: input.organizationId,
    source: input.source,
  });
}

export async function adjustJobDescriptionOnboardedCount(
  tx: DatabaseTransaction,
  input: {
    candidateId: string;
    delta: -1 | 1;
    jobDescriptionId: string;
    now: Date;
    operatorId: string | null;
    operatorRole?: string | null;
    organizationId: string;
  },
) {
  const [job] = await tx
    .select()
    .from(jobDescription)
    .where(
      and(
        eq(jobDescription.id, input.jobDescriptionId),
        eq(jobDescription.organizationId, input.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!job) {
    return;
  }

  const nextOnboardedCount = Math.max(0, (job.onboardedCount ?? 0) + input.delta);
  const staffing = resolveJobDescriptionStaffing({
    headcount: job.headcount,
    onboardedCount: nextOnboardedCount,
  });
  const nextValues = {
    gapCount: staffing.gapCount,
    onboardedCount: nextOnboardedCount,
  };
  await tx
    .update(jobDescription)
    .set({ ...nextValues, updatedAt: input.now })
    .where(
      and(
        eq(jobDescription.id, input.jobDescriptionId),
        eq(jobDescription.organizationId, input.organizationId),
      ),
    );
  await recordJobDescriptionAudit(tx, {
    action: "staffing_counts_updated",
    candidateId: input.candidateId,
    changes: buildJobDescriptionAuditChanges(job, nextValues),
    createdAt: input.now,
    detail: { headcountBelowOnboarded: staffing.headcountBelowOnboarded },
    jobCode: job.code,
    jobDescriptionId: job.id,
    jobName: job.name,
    operatorId: input.operatorId,
    operatorRole: input.operatorRole,
    organizationId: input.organizationId,
    source: input.delta === 1 ? "candidate_hired" : "candidate_reactivated",
  });
}
