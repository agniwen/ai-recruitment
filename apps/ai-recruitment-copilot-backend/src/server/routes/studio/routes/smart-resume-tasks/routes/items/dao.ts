import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  chatAttachment,
  resumeUploadBatchItem,
  smartResumeTask,
  smartResumeTaskItem,
} from "@arc/db-schema/schema";

export async function loadOwnedTaskItemFile(
  taskId: string,
  itemId: string,
  organizationId: string,
  userId: string,
  attachmentId?: string,
) {
  const [item] = await db
    .select({
      filename: resumeUploadBatchItem.originalFileName,
      portfolioAttachments: smartResumeTaskItem.portfolioAttachments,
      storageKey: resumeUploadBatchItem.storageKey,
    })
    .from(smartResumeTaskItem)
    .innerJoin(smartResumeTask, eq(smartResumeTask.id, smartResumeTaskItem.taskId))
    .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
    .where(
      and(
        eq(smartResumeTask.id, taskId),
        eq(smartResumeTask.organizationId, organizationId),
        eq(smartResumeTask.createdBy, userId),
        eq(smartResumeTaskItem.id, itemId),
      ),
    );
  if (!item) {
    return null;
  }
  if (!attachmentId) {
    return { filename: item.filename, mediaType: null, storageKey: item.storageKey };
  }
  if (
    !item.portfolioAttachments.some(
      (attachment) => attachment.id === attachmentId && !("url" in attachment),
    )
  ) {
    return null;
  }
  const [attachment] = await db
    .select({
      filename: chatAttachment.filename,
      mediaType: chatAttachment.mediaType,
      storageKey: chatAttachment.storageKey,
    })
    .from(chatAttachment)
    .where(
      and(
        eq(chatAttachment.id, attachmentId),
        eq(chatAttachment.organizationId, organizationId),
        eq(chatAttachment.userId, userId),
      ),
    );
  return attachment ?? null;
}
