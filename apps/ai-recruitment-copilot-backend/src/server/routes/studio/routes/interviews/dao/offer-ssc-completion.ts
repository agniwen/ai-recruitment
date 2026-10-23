import {
  buildOfferApprovalAttachmentKey,
  deleteObject,
  putObjectBytes,
} from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { MAX_SSC_COMPLETION_SCREENSHOT_BYTES } from "@arc/shared/studio-pipeline-stages";
import {
  completeOfferSscConfirmationWithEvidence,
  loadAuthorizedOfferSscContext,
  OfferDraftError,
} from "./offer-drafts";
import type { OfferSscCompletionInput } from "./offer-drafts";

const screenshotTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function matchesSignature(bytes: Uint8Array, mediaType: string) {
  if (mediaType === "image/png") {
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  }
  if (mediaType === "image/jpeg") {
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  return (
    bytes.length >= 12 &&
    [82, 73, 70, 70].every((value, index) => bytes[index] === value) &&
    [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value)
  );
}

async function prepareScreenshot(file: File) {
  const filename = (file.name.split(/[\\/]/u).pop() ?? "")
    .replaceAll(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 255);
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = screenshotTypes[extension];
  if (!filename || file.size === 0 || !mediaType || mediaType !== file.type.toLowerCase()) {
    throw new OfferDraftError("请上传 JPG、PNG 或 WebP 格式的审批截图。", 400);
  }
  if (file.size > MAX_SSC_COMPLETION_SCREENSHOT_BYTES) {
    throw new OfferDraftError("审批截图不能超过 10 MB。", 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesSignature(bytes, mediaType)) {
    throw new OfferDraftError("审批截图内容与图片格式不一致。", 400);
  }
  return { bytes, extension, filename, mediaType, size: file.size };
}

async function cleanupUpload(storageKey: string | undefined) {
  if (!storageKey) {
    return;
  }
  try {
    await deleteObject(storageKey);
  } catch (error) {
    console.error("Failed to clean up unsaved SSC completion screenshot", error);
  }
}

function assertPreboardingReadiness(
  context: Awaited<ReturnType<typeof loadAuthorizedOfferSscContext>>,
  expectedPreboardingDate: string | undefined,
) {
  if (context.draft.sscConfirmationStatus !== "completed" && !context.draft.preboardingDate) {
    throw new OfferDraftError("请先完成预入职时间确认并录入预入职日期。", 409);
  }
  if (
    expectedPreboardingDate !== undefined &&
    expectedPreboardingDate !== context.draft.preboardingDate
  ) {
    throw new OfferDraftError("预入职日期已更新，请重新打开确认卡片后再完成确认。", 409);
  }
}

export async function completeOfferSscWithScreenshot(
  input: Omit<OfferSscCompletionInput, "completionAttachment"> & { file?: File },
) {
  if (input.internalApprovalConfirmed !== true) {
    throw new OfferDraftError("请确认已经完成内部审批。", 400);
  }
  const context = await loadAuthorizedOfferSscContext({
    ...input,
    ...("telegramUserId" in input.actor
      ? { telegramActor: input.actor }
      : { actorUserId: input.actor.id }),
  });
  if (context.draft.recruiterConfirmationStatus === "pending") {
    throw new OfferDraftError("请先由招聘人员补充并确认候选人私人 TG。", 409);
  }
  if (!context.canConfirm) {
    throw new OfferDraftError("没有 SSC 完成确认权限。", 403);
  }
  if (
    context.draft.sscRevision !== input.revision ||
    context.pipelineStage === "closed" ||
    context.draft.status !== "draft"
  ) {
    throw new OfferDraftError("Offer 已更新或不可确认，请重新打开。", 409);
  }
  if (!["confirming", "completed"].includes(context.draft.sscConfirmationStatus ?? "")) {
    throw new OfferDraftError("请先由 SSC 接收确认。", 409);
  }
  assertPreboardingReadiness(context, input.expectedPreboardingDate);
  const { file, ...completionInput } = input;
  const screenshot =
    file && context.draft.sscConfirmationStatus !== "completed"
      ? await prepareScreenshot(file)
      : null;
  let storageKey: string | undefined;
  try {
    const completionAttachment = screenshot
      ? {
          filename: screenshot.filename,
          mediaType: screenshot.mediaType,
          revision: input.revision,
          size: screenshot.size,
          storageKey: await buildOfferApprovalAttachmentKey(
            crypto.randomUUID(),
            screenshot.extension,
          ),
        }
      : undefined;
    storageKey = completionAttachment?.storageKey;
    if (screenshot && completionAttachment) {
      await putObjectBytes({
        body: screenshot.bytes,
        contentType: screenshot.mediaType,
        storageKey: completionAttachment.storageKey,
      });
    }
    const result = await completeOfferSscConfirmationWithEvidence({
      ...completionInput,
      completionAttachment,
    });
    if (!result.attachmentUsed) {
      await cleanupUpload(storageKey);
    }
    return result.draft;
  } catch (error) {
    await cleanupUpload(storageKey);
    throw error;
  }
}
