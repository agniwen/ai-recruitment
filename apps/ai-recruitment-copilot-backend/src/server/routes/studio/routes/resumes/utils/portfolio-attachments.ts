import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  buildAttachmentKey,
  putObjectBytes,
} from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { chatAttachment } from "@arc/db-schema/schema";
import {
  MAX_PORTFOLIO_ATTACHMENTS,
  MAX_PORTFOLIO_FILE_SIZE_BYTES,
} from "@arc/shared/bulk-resume-upload";
import type { PortfolioAttachment } from "@arc/shared/bulk-resume-upload";

const MIME_BY_EXTENSION: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

export class InvalidPortfolioFileError extends Error {
  override name = "InvalidPortfolioFileError";
}

export async function storePortfolioAttachment(
  value: FormDataEntryValue | null,
  organizationId: string,
  userId: string,
): Promise<PortfolioAttachment> {
  if (!value || typeof value === "string") {
    throw new InvalidPortfolioFileError("请选择作品集文件。");
  }
  const file = value;
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new InvalidPortfolioFileError("作品集仅支持图片、PDF、Office 文档、视频或 ZIP 文件。");
  }
  if (!file.size || file.size > MAX_PORTFOLIO_FILE_SIZE_BYTES || file.name.length > 500) {
    throw new InvalidPortfolioFileError("单个作品集文件不能超过 500 MB，且文件名不超过 500 字符。");
  }
  const id = crypto.randomUUID();
  const storageKey = await buildAttachmentKey(id, extension);
  await putObjectBytes({
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: mimeType,
    storageKey,
  });
  await db.insert(chatAttachment).values({
    filename: file.name,
    id,
    mediaType: mimeType,
    organizationId,
    parsedStatus: "ready",
    size: file.size,
    storageKey,
    userId,
  });
  return { id, mimeType, name: file.name, size: file.size };
}

export async function validatePortfolioAttachments(
  attachments: PortfolioAttachment[],
  organizationId: string,
  userId: string,
): Promise<boolean> {
  if (attachments.length > MAX_PORTFOLIO_ATTACHMENTS) {
    return false;
  }
  if (attachments.length === 0) {
    return true;
  }
  const ids = attachments.map((attachment) => attachment.id);
  if (new Set(ids).size !== ids.length) {
    return false;
  }
  const rows = await db
    .select({
      filename: chatAttachment.filename,
      id: chatAttachment.id,
      mediaType: chatAttachment.mediaType,
      size: chatAttachment.size,
    })
    .from(chatAttachment)
    .where(
      and(
        inArray(chatAttachment.id, ids),
        eq(chatAttachment.organizationId, organizationId),
        eq(chatAttachment.userId, userId),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return attachments.every((attachment) => {
    const row = byId.get(attachment.id);
    return (
      Object.values(MIME_BY_EXTENSION).includes(row?.mediaType ?? "") &&
      row?.filename === attachment.name &&
      row.mediaType === attachment.mimeType &&
      row.size === attachment.size
    );
  });
}
