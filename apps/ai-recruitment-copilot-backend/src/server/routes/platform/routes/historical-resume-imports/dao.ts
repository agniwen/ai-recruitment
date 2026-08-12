import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  organization,
  resumeUploadBatch,
  resumeUploadBatchItem,
  resumeUploadBatchItemAttempt,
  user,
} from "@arc/db-schema/schema";
import type { HistoricalResumeImportQuery } from "./schema";

export async function queryPaginatedHistoricalResumeImports(query: HistoricalResumeImportQuery) {
  const statusFilter =
    query.view === "failed"
      ? and(eq(resumeUploadBatchItem.status, "failed"), gte(resumeUploadBatchItem.failureCount, 3))
      : inArray(resumeUploadBatchItem.status, ["processing", "succeeded"]);
  const search = query.search?.trim();
  const filter = and(
    eq(resumeUploadBatch.sourceChannel, "historical_import"),
    statusFilter,
    search
      ? or(
          ilike(resumeUploadBatchItem.originalFileName, `%${search}%`),
          ilike(resumeUploadBatchItem.sourceFolder, `%${search}%`),
          ilike(organization.name, `%${search}%`),
          ilike(organization.slug, `%${search}%`),
          ilike(user.name, `%${search}%`),
          ilike(user.email, `%${search}%`),
        )
      : undefined,
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
      .orderBy(
        query.view === "records"
          ? sql`case when ${resumeUploadBatchItem.status} = 'processing' then 0 else 1 end`
          : sql`0`,
        desc(
          sql`coalesce(${resumeUploadBatchItem.finishedAt}, ${resumeUploadBatchItem.startedAt}, ${resumeUploadBatch.createdAt})`,
        ),
        desc(resumeUploadBatchItem.id),
      )
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
