import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  organization,
  resumePoolItem,
  resumeUploadBatch,
  resumeUploadBatchItem,
  resumeUploadBatchItemAttempt,
  user,
} from "@arc/db-schema/schema";
import { reconcileBatchProgress } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches";
import type { HistoricalResumeImportQuery, RetryHistoricalResumeImportsInput } from "./schema";

function historicalResumeImportSearchFilter(search: string | undefined) {
  const value = search?.trim();
  return value
    ? or(
        ilike(resumeUploadBatchItem.originalFileName, `%${value}%`),
        ilike(resumeUploadBatchItem.sourceFolder, `%${value}%`),
        ilike(organization.name, `%${value}%`),
        ilike(organization.slug, `%${value}%`),
        ilike(user.name, `%${value}%`),
        ilike(user.email, `%${value}%`),
      )
    : undefined;
}

function failedHistoricalResumeImportFilter(search: string | undefined) {
  return and(
    eq(resumeUploadBatch.sourceChannel, "historical_import"),
    eq(resumeUploadBatchItem.status, "failed"),
    gte(resumeUploadBatchItem.failureCount, 3),
    historicalResumeImportSearchFilter(search),
  );
}

export function historicalResumeImportOrderBy(view: HistoricalResumeImportQuery["view"]) {
  const timeOrder = desc(
    sql`coalesce(${resumeUploadBatchItem.finishedAt}, ${resumeUploadBatchItem.startedAt}, ${resumeUploadBatch.createdAt})`,
  );
  const stableOrder = desc(resumeUploadBatchItem.id);
  if (view === "records") {
    return [
      sql`case when ${resumeUploadBatchItem.status} = 'processing' then 0 else 1 end`,
      timeOrder,
      stableOrder,
    ];
  }
  return [timeOrder, stableOrder];
}

export async function queryPaginatedHistoricalResumeImports(query: HistoricalResumeImportQuery) {
  const statusFilter =
    query.view === "failed"
      ? and(eq(resumeUploadBatchItem.status, "failed"), gte(resumeUploadBatchItem.failureCount, 3))
      : inArray(resumeUploadBatchItem.status, ["processing", "succeeded"]);
  const filter = and(
    eq(resumeUploadBatch.sourceChannel, "historical_import"),
    statusFilter,
    historicalResumeImportSearchFilter(query.search),
  );
  const latestFailedStep = sql<string | null>`(
    select ${resumeUploadBatchItemAttempt.failedStep}
    from ${resumeUploadBatchItemAttempt}
    where ${resumeUploadBatchItemAttempt.itemId} = ${resumeUploadBatchItem.id}
      and ${resumeUploadBatchItemAttempt.status} = 'failed'
    order by ${resumeUploadBatchItemAttempt.attemptNumber} desc
    limit 1
  )`;
  const latestFailureReason = sql<string | null>`(
    select ${resumeUploadBatchItemAttempt.errorMessage}
    from ${resumeUploadBatchItemAttempt}
    where ${resumeUploadBatchItemAttempt.itemId} = ${resumeUploadBatchItem.id}
      and ${resumeUploadBatchItemAttempt.status} = 'failed'
    order by ${resumeUploadBatchItemAttempt.attemptNumber} desc
    limit 1
  )`;
  const [records, [{ total }]] = await Promise.all([
    db
      .select({
        currentStep: resumeUploadBatchItem.currentStep,
        failedStep: latestFailedStep,
        failureCount: resumeUploadBatchItem.failureCount,
        failureReason: latestFailureReason,
        filename: resumeUploadBatchItem.originalFileName,
        finishedAt: resumeUploadBatchItem.finishedAt,
        id: resumeUploadBatchItem.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        poolItemId: resumeUploadBatchItem.poolItemId,
        sourceFolder: resumeUploadBatchItem.sourceFolder,
        startedAt: resumeUploadBatchItem.startedAt,
        status: resumeUploadBatchItem.status,
        uploaderEmail: user.email,
        uploaderName: user.name,
      })
      .from(resumeUploadBatchItem)
      .innerJoin(resumeUploadBatch, eq(resumeUploadBatch.id, resumeUploadBatchItem.batchId))
      .innerJoin(organization, eq(organization.id, resumeUploadBatch.organizationId))
      .innerJoin(user, eq(user.id, resumeUploadBatch.createdBy))
      .where(filter)
      .orderBy(...historicalResumeImportOrderBy(query.view))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(resumeUploadBatchItem)
      .innerJoin(resumeUploadBatch, eq(resumeUploadBatch.id, resumeUploadBatchItem.batchId))
      .innerJoin(organization, eq(organization.id, resumeUploadBatch.organizationId))
      .innerJoin(user, eq(user.id, resumeUploadBatch.createdBy))
      .where(filter),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    records: records.map((record) => ({
      ...record,
      finishedAt: record.finishedAt?.toISOString() ?? null,
      startedAt: record.startedAt?.toISOString() ?? null,
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function retryHistoricalResumeImports(input: RetryHistoricalResumeImportsInput) {
  const { affectedBatchIds, retriedCount } = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        batchId: resumeUploadBatchItem.batchId,
        id: resumeUploadBatchItem.id,
        poolItemId: resumeUploadBatchItem.poolItemId,
      })
      .from(resumeUploadBatchItem)
      .innerJoin(resumeUploadBatch, eq(resumeUploadBatch.id, resumeUploadBatchItem.batchId))
      .innerJoin(organization, eq(organization.id, resumeUploadBatch.organizationId))
      .innerJoin(user, eq(user.id, resumeUploadBatch.createdBy))
      .where(failedHistoricalResumeImportFilter(input.search))
      .for("update");
    if (rows.length === 0) {
      return { affectedBatchIds: [], retriedCount: 0 };
    }

    const batchIds = [...new Set(rows.map((row) => row.batchId))];
    const itemIds = rows.map((row) => row.id);
    const poolItemIds = rows.flatMap((row) => (row.poolItemId ? [row.poolItemId] : []));
    const now = new Date();

    await tx
      .update(resumeUploadBatchItem)
      .set({
        currentStep: null,
        errorMessage: null,
        failureCount: 0,
        finishedAt: null,
        queuedAt: now,
        startedAt: null,
        status: "pending",
      })
      .where(inArray(resumeUploadBatchItem.id, itemIds));
    if (poolItemIds.length > 0) {
      await tx
        .update(resumePoolItem)
        .set({ resumeParseError: null, resumeParseStatus: "queued", updatedAt: now })
        .where(inArray(resumePoolItem.id, poolItemIds));
    }
    await tx
      .update(resumeUploadBatch)
      .set({ completedAt: null, status: "pending", updatedAt: now })
      .where(inArray(resumeUploadBatch.id, batchIds));
    return { affectedBatchIds: batchIds, retriedCount: itemIds.length };
  });

  await Promise.all(affectedBatchIds.map((batchId) => reconcileBatchProgress(batchId)));
  return { retriedCount };
}
