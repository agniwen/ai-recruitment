import {
  buildOfferApprovalAttachmentKey,
  putObjectBytes,
} from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { MAX_OFFER_APPROVAL_ATTACHMENT_BYTES } from "@arc/shared/studio-pipeline-stages";

const PREVIEW_IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function isPreviewImage(mediaType: string): boolean {
  return Object.values(PREVIEW_IMAGE_TYPES).includes(mediaType);
}

export function validateOfferApprovalAttachment(file: File): string | null {
  if (!file.name.trim() || file.size === 0) {
    return "请选择非空附件。";
  }
  if (file.size > MAX_OFFER_APPROVAL_ATTACHMENT_BYTES) {
    return "附件不能超过 20 MB。";
  }
  return null;
}

export async function storeOfferApprovalAttachment(file: File) {
  const filename = (file.name.split(/[\\/]/).pop() || "附件").slice(0, 255);
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : "bin";
  const mediaType =
    PREVIEW_IMAGE_TYPES[extension] === file.type.toLowerCase()
      ? file.type.toLowerCase()
      : "application/octet-stream";
  const storageKey = await buildOfferApprovalAttachmentKey(crypto.randomUUID(), extension);
  await putObjectBytes({
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: mediaType,
    storageKey,
  });
  return { filename, mediaType, size: file.size, storageKey };
}
