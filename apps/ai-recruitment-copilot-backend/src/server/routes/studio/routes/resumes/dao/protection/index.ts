import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  globalConfig,
  hiringUnit,
  jobDescription,
  resumeProtectionCycle,
  resumeProtectionRecommendation,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import type {
  ResumeProtectionIdentity,
  ResumeProtectionSummary,
} from "@arc/db-schema/resume-protection";
import { normalizeProtectionIdentity, protectionIdentityMatch } from "./policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;
type Cycle = typeof resumeProtectionCycle.$inferSelect;

export function identityForResume(
  row: Pick<
    typeof studioInterview.$inferSelect,
    "candidateName" | "candidateEmail" | "candidatePhone" | "resumeContentHash" | "resumeProfile"
  >,
): ResumeProtectionIdentity {
  return normalizeProtectionIdentity({
    contentHash: row.resumeContentHash,
    email: row.resumeProfile?.email || row.candidateEmail,
    name: row.resumeProfile?.name || row.candidateName,
    phone: row.resumeProfile?.phone || row.candidatePhone,
  });
}

async function matchingCycles(
  executor: Executor,
  organizationId: string,
  identity: ResumeProtectionIdentity,
  now: Date,
) {
  const matches = (
    column: typeof resumeProtectionCycle.identity | typeof resumeProtectionRecommendation.identity,
  ) =>
    or(
      identity.contentHash ? sql`${column}->>'contentHash' = ${identity.contentHash}` : undefined,
      identity.email ? sql`${column}->>'email' = ${identity.email}` : undefined,
      identity.phone ? sql`${column}->>'phone' = ${identity.phone}` : undefined,
    );
  if (!identity.contentHash && !identity.email && !identity.phone) {
    return [];
  }
  const rows = await executor
    .select({
      cycle: resumeProtectionCycle,
      recommendationIdentity: resumeProtectionRecommendation.identity,
    })
    .from(resumeProtectionCycle)
    .leftJoin(
      resumeProtectionRecommendation,
      eq(resumeProtectionRecommendation.cycleId, resumeProtectionCycle.id),
    )
    .where(
      and(
        eq(resumeProtectionCycle.organizationId, organizationId),
        lte(resumeProtectionCycle.startsAt, now),
        gt(resumeProtectionCycle.expiresAt, now),
        or(
          matches(resumeProtectionCycle.identity),
          matches(resumeProtectionRecommendation.identity),
        ),
      ),
    )
    .orderBy(asc(resumeProtectionCycle.startsAt), asc(resumeProtectionCycle.id));
  const found = new Set<string>();
  return rows.flatMap(({ cycle, recommendationIdentity }) => {
    const basis =
      protectionIdentityMatch(identity, cycle.identity) ||
      (recommendationIdentity ? protectionIdentityMatch(identity, recommendationIdentity) : null);
    if (!basis || found.has(cycle.id)) {
      return [];
    }
    found.add(cycle.id);
    return [{ basis, cycle }];
  });
}

async function summarize(
  executor: Executor,
  cycle: Cycle,
  matchBasis: string,
  now: Date,
): Promise<ResumeProtectionSummary> {
  const rows = await executor
    .select({ name: resumeProtectionRecommendation.hiringUnitName })
    .from(resumeProtectionRecommendation)
    .where(eq(resumeProtectionRecommendation.cycleId, cycle.id));
  return {
    checkedAt: now.toISOString(),
    cycleId: cycle.id,
    durationDays: cycle.durationDays,
    expiresAt: cycle.expiresAt.toISOString(),
    hiringUnitNames: [...new Set(rows.flatMap((row) => (row.name ? [row.name] : [])))],
    matchBasis,
    ownerName: cycle.ownerName,
    ownerUserId: cycle.ownerUserId,
    startsAt: cycle.startsAt.toISOString(),
  };
}

export async function findResumeProtectionConflict(
  input: {
    organizationId: string;
    userId: string;
    identity: ResumeProtectionIdentity;
  },
  executor: Executor = db,
): Promise<ResumeProtectionSummary | null> {
  const now = new Date();
  const matches = await matchingCycles(
    executor,
    input.organizationId,
    normalizeProtectionIdentity(input.identity),
    now,
  );
  const conflict = matches.find(({ cycle }) => cycle.ownerUserId !== input.userId);
  return conflict ? summarize(executor, conflict.cycle, conflict.basis, now) : null;
}

async function acceptRecommendation(
  tx: Tx,
  row: typeof studioInterview.$inferSelect,
  identity: ResumeProtectionIdentity,
  existingCycle: Cycle | undefined,
  now: Date,
  ownerUserId: string,
  verifiedDurationDays?: number,
) {
  const [job] = row.jobDescriptionId
    ? await tx
        .select({ hiringUnitId: jobDescription.hiringUnitId, name: jobDescription.name })
        .from(jobDescription)
        .where(
          and(
            eq(jobDescription.id, row.jobDescriptionId),
            eq(jobDescription.organizationId, row.organizationId),
          ),
        )
        .limit(1)
    : [];
  const unitId = job?.hiringUnitId || row.hiringUnitId;
  const [unit] = unitId
    ? await tx
        .select({ name: hiringUnit.name })
        .from(hiringUnit)
        .where(and(eq(hiringUnit.id, unitId), eq(hiringUnit.organizationId, row.organizationId)))
        .limit(1)
    : [];
  if (!unitId) {
    await tx
      .update(studioInterview)
      .set({ resumeAdmissionCheckedAt: now, resumeAdmissionStatus: "accepted" })
      .where(eq(studioInterview.id, row.id));
    return "accepted" as const;
  }
  if (!unit) {
    throw new Error("所选用人组织不存在或不属于当前工作区。");
  }
  let cycle = existingCycle;
  if (!cycle) {
    const [config] = await tx
      .select({ days: globalConfig.resumeProtectionDays })
      .from(globalConfig)
      .where(eq(globalConfig.organizationId, row.organizationId))
      .limit(1);
    const [owner] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, ownerUserId))
      .limit(1);
    const durationDays = verifiedDurationDays ?? config?.days ?? 15;
    [cycle] = await tx
      .insert(resumeProtectionCycle)
      .values({
        durationDays,
        expiresAt: new Date(now.getTime() + durationDays * 86_400_000),
        id: crypto.randomUUID(),
        identity,
        organizationId: row.organizationId,
        ownerName: owner?.name || "原推荐人",
        ownerUserId,
        startsAt: now,
      })
      .returning();
  }
  await tx
    .insert(resumeProtectionRecommendation)
    .values({
      cycleId: cycle.id,
      hiringUnitName: unit?.name ?? null,
      identity,
      recommendedAt: now,
      recordId: row.id,
      targetRole: job?.name || row.targetRole,
    })
    .onConflictDoNothing();
  await tx
    .update(studioInterview)
    .set({
      resumeAdmissionCheckedAt: now,
      resumeAdmissionStatus: "accepted",
      resumeProtection: null,
      resumeProtectionCycleId: cycle.id,
    })
    .where(eq(studioInterview.id, row.id));
  return "accepted" as const;
}

// Serialize the decision and the recommendation in the same transaction. The
// database lookup also sees recommendations not yet present in the vector index.
export async function admitResumeRecord(
  tx: Tx,
  recordId: string,
  organizationId: string,
  allowStart = true,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`resume-protection:${organizationId}`}, 0))`,
  );
  const [row] = await tx
    .select()
    .from(studioInterview)
    .where(
      and(eq(studioInterview.id, recordId), eq(studioInterview.organizationId, organizationId)),
    )
    .limit(1);
  if (!row) {
    throw new Error("候选人记录不存在。");
  }
  if (row.resumeAdmissionStatus === "accepted" && row.resumeProtectionCycleId) {
    return "accepted" as const;
  }
  if (row.resumeAdmissionStatus === "accepted" && !row.resumeAdmissionCheckedAt) {
    // Legacy accepted recommendations require verified historical dates, never
    // start a new protection cycle merely because a worker reprocesses them.
    return "accepted" as const;
  }
  // Editing or reparsing a blocked upload never implicitly submits it.
  if (row.resumeAdmissionStatus === "protected") {
    return "protected" as const;
  }
  if (!row.createdBy || !row.resumeProfile || row.resumeParseStatus !== "ready") {
    await tx
      .update(studioInterview)
      .set({ resumeAdmissionStatus: "pending" })
      .where(eq(studioInterview.id, recordId));
    return "pending" as const;
  }
  const now = new Date();
  const identity = identityForResume(row);
  if (!identity.contentHash && !identity.email && !identity.phone) {
    await tx
      .update(studioInterview)
      .set({ resumeAdmissionStatus: "pending" })
      .where(eq(studioInterview.id, recordId));
    return "pending" as const;
  }
  const matches = await matchingCycles(tx, organizationId, identity, now);
  const conflict = matches.find(({ cycle }) => cycle.ownerUserId !== row.createdBy);
  if (conflict) {
    await tx
      .update(studioInterview)
      .set({
        resumeAdmissionCheckedAt: now,
        resumeAdmissionStatus: "protected",
        resumeEvaluationStatus: null,
        resumeProtection: await summarize(tx, conflict.cycle, conflict.basis, now),
        resumeReview: null,
        resumeReviewError: null,
        resumeReviewGeneratedAt: null,
        resumeReviewQueuedAt: null,
        resumeReviewRunId: null,
        resumeReviewStatus: "idle",
        resumeScreeningError: null,
        resumeScreeningEvaluatedAt: null,
        resumeScreeningResult: null,
        resumeScreeningStatus: "idle",
      })
      .where(eq(studioInterview.id, recordId));
    return "protected" as const;
  }
  if (!allowStart) {
    return "pending" as const;
  }
  return acceptRecommendation(tx, row, identity, matches[0]?.cycle, now, row.createdBy);
}

export async function isResumeAdmitted(recordId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: studioInterview.resumeAdmissionStatus })
    .from(studioInterview)
    .where(
      and(eq(studioInterview.id, recordId), eq(studioInterview.organizationId, organizationId)),
    )
    .limit(1);
  return row?.status === "accepted";
}

// Explicit historical data only: uploads/reparses never invent recommendation
// dates. Run this before new writes when activating protection for old records.
export async function importVerifiedResumeProtection(
  tx: Tx,
  input: {
    organizationId: string;
    recordId: string;
    recommendedAt: Date;
    durationDays: number;
  },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`resume-protection:${input.organizationId}`}, 0))`,
  );
  const [row] = await tx
    .select()
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.recordId),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (
    !row ||
    row.resumeAdmissionStatus !== "accepted" ||
    !row.createdBy ||
    !row.resumeProfile ||
    row.resumeParseStatus !== "ready"
  ) {
    throw new Error(`历史推荐 ${input.recordId} 缺少有效候选人、推荐人或工作区依据。`);
  }
  if (row.resumeProtectionCycleId) {
    return "existing" as const;
  }
  const identity = identityForResume(row);
  if (!identity.contentHash && !identity.email && !identity.phone) {
    throw new Error(`历史推荐 ${row.id} 缺少身份依据。`);
  }
  const matches = await matchingCycles(tx, input.organizationId, identity, input.recommendedAt);
  if (matches.some(({ cycle }) => cycle.ownerUserId !== row.createdBy)) {
    throw new Error(`历史推荐 ${row.id} 存在推荐归属冲突，请业务核实。`);
  }
  // Do not backdate into a period already owned by a later recommendation.
  const later = await tx
    .select()
    .from(resumeProtectionCycle)
    .where(
      and(
        eq(resumeProtectionCycle.organizationId, input.organizationId),
        gt(resumeProtectionCycle.startsAt, input.recommendedAt),
      ),
    );
  if (later.some((cycle) => protectionIdentityMatch(identity, cycle.identity))) {
    throw new Error(`历史推荐 ${row.id} 已有后续保护周期，请业务核实。`);
  }
  const accepted = await acceptRecommendation(
    tx,
    row,
    identity,
    matches[0]?.cycle,
    input.recommendedAt,
    row.createdBy,
    input.durationDays,
  );
  if (accepted !== "accepted" || (!row.hiringUnitId && !row.jobDescriptionId)) {
    throw new Error(`历史推荐 ${row.id} 缺少用人组织。`);
  }
  const [updated] = await tx
    .select({ cycleId: studioInterview.resumeProtectionCycleId })
    .from(studioInterview)
    .where(eq(studioInterview.id, row.id))
    .limit(1);
  if (!updated?.cycleId) {
    throw new Error(`历史推荐 ${row.id} 缺少有效用人组织。`);
  }
  return "imported" as const;
}

export async function loadResumeProtectionDetails(recordId: string, organizationId: string) {
  const [row] = await db
    .select({ protection: studioInterview.resumeProtection })
    .from(studioInterview)
    .where(
      and(eq(studioInterview.id, recordId), eq(studioInterview.organizationId, organizationId)),
    )
    .limit(1);
  if (!row?.protection) {
    return null;
  }
  const [cycle] = await db
    .select()
    .from(resumeProtectionCycle)
    .where(
      and(
        eq(resumeProtectionCycle.id, row.protection.cycleId),
        eq(resumeProtectionCycle.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!cycle) {
    return null;
  }
  const recommendations = await db
    .select({
      hiringUnitName: resumeProtectionRecommendation.hiringUnitName,
      outcome: studioInterview.outcome,
      pipelineStage: studioInterview.pipelineStage,
      recommendedAt: resumeProtectionRecommendation.recommendedAt,
      targetRole: resumeProtectionRecommendation.targetRole,
    })
    .from(resumeProtectionRecommendation)
    .leftJoin(
      studioInterview,
      and(
        eq(studioInterview.id, resumeProtectionRecommendation.recordId),
        eq(studioInterview.organizationId, organizationId),
      ),
    )
    .where(eq(resumeProtectionRecommendation.cycleId, cycle.id))
    .orderBy(asc(resumeProtectionRecommendation.recommendedAt));
  return {
    protection: await summarize(db, cycle, row.protection.matchBasis, new Date()),
    recommendations: recommendations.map((entry) => ({
      ...entry,
      recommendedAt: entry.recommendedAt.toISOString(),
    })),
  };
}
