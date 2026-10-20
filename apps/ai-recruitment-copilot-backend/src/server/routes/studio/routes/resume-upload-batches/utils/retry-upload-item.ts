import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { resumeUploadBatch, resumeUploadBatchItem } from "@arc/db-schema/schema";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { retryFailedResumeParse } from "./retry";
import type { ResumeParseRetryTarget } from "../dao/retry";

export async function retryUploadItem(input: {
  itemId: string;
  organizationId?: string;
  requestedBy: string;
  userId?: string;
}) {
  const [row] = await db
    .select({
      organizationId: resumeUploadBatch.organizationId,
      poolItemId: resumeUploadBatchItem.poolItemId,
      resumeRecordId: resumeUploadBatchItem.resumeRecordId,
      target: resumeUploadBatch.target,
    })
    .from(resumeUploadBatchItem)
    .innerJoin(resumeUploadBatch, eq(resumeUploadBatch.id, resumeUploadBatchItem.batchId))
    .where(
      and(
        eq(resumeUploadBatchItem.id, input.itemId),
        input.organizationId
          ? eq(resumeUploadBatch.organizationId, input.organizationId)
          : undefined,
        input.userId ? eq(resumeUploadBatch.createdBy, input.userId) : undefined,
      ),
    )
    .limit(1);
  if (!row) {
    return { status: "not_found" as const };
  }
  let target: ResumeParseRetryTarget | null = null;
  if (row.target === "resume_library" && row.resumeRecordId) {
    target = { resumeRecordId: row.resumeRecordId };
  } else if (row.target === "resume_pool" && row.poolItemId) {
    target = { poolItemId: row.poolItemId };
  }
  if (!target) {
    return { status: "not_found" as const };
  }
  const result = await retryFailedResumeParse({
    ...target,
    allowExhaustedRetries: true,
    itemId: input.itemId,
    organizationId: row.organizationId,
    requestedBy: input.requestedBy,
  });
  if (result.status === "queued") {
    invalidateStudioInterviewCaches(row.organizationId);
  }
  return result;
}
