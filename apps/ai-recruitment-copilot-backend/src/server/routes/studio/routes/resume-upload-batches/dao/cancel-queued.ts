import { and, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { resumeUploadBatchItem, resumePoolItem, studioInterview } from "@arc/db-schema/schema";
import { reconcileBatchProgress } from "./batches";

export async function cancelQueuedUploadItems(itemIds: string[]) {
  if (itemIds.length === 0) {
    return;
  }
  const batchIds = new Set<string>();
  // Bound SQL parameter counts for large queues.
  for (let offset = 0; offset < itemIds.length; offset += 500) {
    await db.transaction(async (tx) => {
      const now = new Date();
      const items = await tx
        .update(resumeUploadBatchItem)
        .set({ errorMessage: "管理员已清空解析队列", finishedAt: now, status: "cancelled" })
        .where(
          and(
            inArray(resumeUploadBatchItem.id, itemIds.slice(offset, offset + 500)),
            inArray(resumeUploadBatchItem.status, ["pending", "processing"]),
          ),
        )
        .returning();
      for (const item of items) {
        batchIds.add(item.batchId);
      }
      const recordIds = items.flatMap((item) => (item.resumeRecordId ? [item.resumeRecordId] : []));
      const poolIds = items.flatMap((item) => (item.poolItemId ? [item.poolItemId] : []));
      if (recordIds.length) {
        await tx
          .update(studioInterview)
          .set({ resumeParseError: null, resumeParseStatus: "unparsed", updatedAt: now })
          .where(
            and(
              inArray(studioInterview.id, recordIds),
              inArray(studioInterview.resumeParseStatus, ["queued", "processing"]),
            ),
          );
      }
      if (poolIds.length) {
        await tx
          .update(resumePoolItem)
          .set({ resumeParseError: null, resumeParseStatus: "unparsed", updatedAt: now })
          .where(
            and(
              inArray(resumePoolItem.id, poolIds),
              inArray(resumePoolItem.resumeParseStatus, ["queued", "processing"]),
            ),
          );
      }
    });
  }
  for (const batchId of batchIds) {
    await reconcileBatchProgress(batchId);
  }
}
