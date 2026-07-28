import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  JobDescriptionGoogleSheetsSyncResult,
  JobDescriptionGoogleSheetsSyncRun,
} from "@arc/shared/job-descriptions";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { jobDescriptionGoogleSheetSyncRun } from "@arc/db-schema/schema";

type SyncRunRow = typeof jobDescriptionGoogleSheetSyncRun.$inferSelect;

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
}): Promise<{ created: boolean; run: JobDescriptionGoogleSheetsSyncRun }> {
  const [created] = await db
    .insert(jobDescriptionGoogleSheetSyncRun)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      requestedBy: input.requestedBy,
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

export async function claimGoogleSheetSyncRun(
  runId: string,
): Promise<{ organizationId: string; requestedBy: string | null } | null> {
  const now = new Date();
  const [claimed] = await db
    .update(jobDescriptionGoogleSheetSyncRun)
    .set({ error: null, startedAt: now, status: "running", updatedAt: now })
    .where(
      and(
        eq(jobDescriptionGoogleSheetSyncRun.id, runId),
        inArray(jobDescriptionGoogleSheetSyncRun.status, ["queued", "running"]),
      ),
    )
    .returning({
      organizationId: jobDescriptionGoogleSheetSyncRun.organizationId,
      requestedBy: jobDescriptionGoogleSheetSyncRun.requestedBy,
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
    .where(eq(jobDescriptionGoogleSheetSyncRun.id, runId));
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
    .where(eq(jobDescriptionGoogleSheetSyncRun.id, runId));
}
