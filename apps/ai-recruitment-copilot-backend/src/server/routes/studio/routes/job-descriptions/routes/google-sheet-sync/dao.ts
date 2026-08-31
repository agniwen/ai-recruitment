import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  JobDescriptionGoogleSheetsSyncResult,
  JobDescriptionGoogleSheetsSyncRun,
} from "@arc/shared/job-descriptions";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { jobDescriptionGoogleSheetSyncRun } from "@arc/db-schema/schema";

type SyncRunRow = typeof jobDescriptionGoogleSheetSyncRun.$inferSelect;

/** Active runs older than this are treated as lost and auto-failed. */
export const GOOGLE_SHEET_SYNC_STALE_MS = 15 * 60 * 1000;

function toSyncRun(row: SyncRunRow): JobDescriptionGoogleSheetsSyncRun {
  return {
    createdAt: row.createdAt.toISOString(),
    error: row.error,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    id: row.id,
    result: row.result,
    startedAt: row.startedAt?.toISOString() ?? null,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadActiveGoogleSheetSyncRun(
  organizationId: string,
): Promise<JobDescriptionGoogleSheetsSyncRun | null> {
  const [row] = await db
    .select()
    .from(jobDescriptionGoogleSheetSyncRun)
    .where(
      and(
        eq(jobDescriptionGoogleSheetSyncRun.organizationId, organizationId),
        inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return row ? toSyncRun(row) : null;
}

export async function createOrGetActiveGoogleSheetSyncRun(input: {
  organizationId: string;
  requestedBy: string | null;
  requestedByRole: string | null;
}): Promise<{ created: boolean; run: JobDescriptionGoogleSheetsSyncRun }> {
  const [created] = await db
    .insert(jobDescriptionGoogleSheetSyncRun)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      requestedBy: input.requestedBy,
      requestedByRole: input.requestedByRole,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return { created: true, run: toSyncRun(created) };
  }

  const active = await loadActiveGoogleSheetSyncRun(input.organizationId);
  if (active) {
    return { created: false, run: active };
  }

  // The conflicting active run may have completed between INSERT and SELECT.
  return createOrGetActiveGoogleSheetSyncRun(input);
}

export async function loadLatestGoogleSheetSyncRun(
  organizationId: string,
): Promise<JobDescriptionGoogleSheetsSyncRun | null> {
  const [row] = await db
    .select()
    .from(jobDescriptionGoogleSheetSyncRun)
    .where(eq(jobDescriptionGoogleSheetSyncRun.organizationId, organizationId))
    .orderBy(desc(jobDescriptionGoogleSheetSyncRun.createdAt))
    .limit(1);
  return row ? toSyncRun(row) : null;
}

/**
 * List active runs that workers should re-enqueue (or that are eligible for stale failure).
 */
export async function listActiveGoogleSheetSyncRuns(): Promise<
  { id: string; organizationId: string; status: "queued" | "running"; updatedAt: Date }[]
> {
  const rows = await db
    .select({
      id: jobDescriptionGoogleSheetSyncRun.id,
      organizationId: jobDescriptionGoogleSheetSyncRun.organizationId,
      status: jobDescriptionGoogleSheetSyncRun.status,
      updatedAt: jobDescriptionGoogleSheetSyncRun.updatedAt,
    })
    .from(jobDescriptionGoogleSheetSyncRun)
    .where(inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]));
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    status: row.status as "queued" | "running",
    updatedAt: row.updatedAt,
  }));
}

/**
 * Fail active runs that have not made progress for longer than `staleMs`.
 * Uses `updatedAt` so both never-started and mid-run stalls are covered.
 * Returns the failed run ids.
 */
export async function failStaleGoogleSheetSyncRuns(input?: {
  organizationId?: string;
  staleMs?: number;
}): Promise<string[]> {
  const staleMs = input?.staleMs ?? GOOGLE_SHEET_SYNC_STALE_MS;
  const cutoff = new Date(Date.now() - staleMs);
  const now = new Date();
  const conditions = [
    inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]),
    lt(jobDescriptionGoogleSheetSyncRun.updatedAt, cutoff),
  ];
  if (input?.organizationId) {
    conditions.push(eq(jobDescriptionGoogleSheetSyncRun.organizationId, input.organizationId));
  }
  const rows = await db
    .update(jobDescriptionGoogleSheetSyncRun)
    .set({
      error: "同步任务超时未完成，已自动取消。请重新点击同步。",
      finishedAt: now,
      status: "failed",
      updatedAt: now,
    })
    .where(and(...conditions))
    .returning({ id: jobDescriptionGoogleSheetSyncRun.id });
  return rows.map((row) => row.id);
}

export async function claimGoogleSheetSyncRun(runId: string): Promise<{
  organizationId: string;
  requestedBy: string | null;
  requestedByRole: string | null;
} | null> {
  const now = new Date();
  const [claimed] = await db
    .update(jobDescriptionGoogleSheetSyncRun)
    .set({
      error: null,
      startedAt: sql`coalesce(${jobDescriptionGoogleSheetSyncRun.startedAt}, now())`,
      status: "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(jobDescriptionGoogleSheetSyncRun.id, runId),
        inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]),
      ),
    )
    .returning({
      organizationId: jobDescriptionGoogleSheetSyncRun.organizationId,
      requestedBy: jobDescriptionGoogleSheetSyncRun.requestedBy,
      requestedByRole: jobDescriptionGoogleSheetSyncRun.requestedByRole,
    });
  return claimed ?? null;
}

export async function completeGoogleSheetSyncRun(
  runId: string,
  result: JobDescriptionGoogleSheetsSyncResult,
): Promise<void> {
  const now = new Date();
  await db
    .update(jobDescriptionGoogleSheetSyncRun)
    .set({
      error: null,
      finishedAt: now,
      result,
      status: "succeeded",
      updatedAt: now,
    })
    .where(
      and(
        eq(jobDescriptionGoogleSheetSyncRun.id, runId),
        inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]),
      ),
    );
}

export async function failGoogleSheetSyncRun(runId: string, error: string): Promise<void> {
  const now = new Date();
  await db
    .update(jobDescriptionGoogleSheetSyncRun)
    .set({
      error,
      finishedAt: now,
      status: "failed",
      updatedAt: now,
    })
    .where(
      and(
        eq(jobDescriptionGoogleSheetSyncRun.id, runId),
        inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]),
      ),
    );
}
