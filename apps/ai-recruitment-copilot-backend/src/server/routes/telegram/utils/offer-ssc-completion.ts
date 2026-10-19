import { randomUUID } from "node:crypto";
import type { ActionEvent, Message } from "chat";
import { z } from "zod";
import { completeOfferSscWithScreenshot } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-completion";
import {
  loadAuthorizedOfferSscContext,
  OfferDraftError,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { resolveBoundTelegramOfferActor } from "../offer-ssc-dao";
import { buildTelegramOfferCard, buildTelegramOfferCompletionCard } from "./offer-ssc-card";
import { updateTelegramOfferMessages } from "./offer-ssc-message";
import { downloadTelegramOfferScreenshot } from "./offer-ssc-screenshot";
import {
  MAX_TELEGRAM_SCREENSHOT_BYTES,
  TELEGRAM_COMPLETION_TTL_MS,
  withTelegramOfferCompletionState,
} from "./offer-ssc-state";
import type {
  TelegramOfferCompletionPending,
  TelegramScreenshotReference,
} from "./offer-ssc-state";

interface CompletionIdentity {
  actorUserId: string;
  chatId: string;
  messageId: number;
}
type CompletionThread = NonNullable<ActionEvent["thread"]>;

const privateImageMessage = z.object({
  chat: z.object({ id: z.number().int().positive(), type: z.literal("private") }),
  document: z
    .object({
      file_id: z.string().min(1).max(500),
      file_name: z.string().optional(),
      file_size: z.number().int().positive().optional(),
      mime_type: z.string().optional(),
    })
    .optional(),
  edit_date: z.number().optional(),
  from: z.object({ id: z.number().int().positive(), username: z.string().optional() }),
  message_id: z.number().int().positive(),
  photo: z
    .array(
      z.object({
        file_id: z.string().min(1).max(500),
        file_size: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  reply_to_message: z.object({ message_id: z.number().int().positive() }).optional(),
});

function unavailable(): OfferDraftError {
  return new OfferDraftError("本次确认已过期、取消或正在处理，请从 Offer 重新打开。", 409);
}

function pendingFor(
  pending: Record<string, TelegramOfferCompletionPending>,
  token: string,
  identity: CompletionIdentity,
) {
  const record = pending[token];
  if (
    !record ||
    record.status !== "pending" ||
    record.actorUserId !== identity.actorUserId ||
    record.chatId !== identity.chatId ||
    record.promptMessageId !== identity.messageId
  ) {
    throw unavailable();
  }
  return record;
}

function sentMessageId(id: string, chatId: string): number {
  const match = /^(\d+):(\d+)$/u.exec(id);
  if (
    !match ||
    match[1] !== chatId ||
    !Number.isSafeInteger(Number(match[2])) ||
    Number(match[2]) < 1
  ) {
    throw unavailable();
  }
  return Number(match[2]);
}

async function authorizedContext(
  record: Pick<TelegramOfferCompletionPending, "draftId" | "actorUserId" | "revision">,
) {
  const context = await loadAuthorizedOfferSscContext({
    actorUserId: record.actorUserId,
    draftId: record.draftId,
  });
  if (!context.canConfirm) {
    throw new OfferDraftError("没有 SSC 完成确认权限。", 403);
  }
  if (context.draft.sscRevision !== record.revision) {
    throw new OfferDraftError("Offer 内容已更新，请重新打开后确认。", 409);
  }
  if (
    context.draft.status !== "draft" ||
    context.draft.sscConfirmationStatus !== "confirming" ||
    context.pipelineStage === "closed"
  ) {
    throw new OfferDraftError("该 Offer 当前不能完成 SSC 确认，请重新打开。", 409);
  }
  return context;
}

async function removePending(thread: CompletionThread, chatId: string, token: string) {
  await withTelegramOfferCompletionState(thread, chatId, (pending) => {
    Reflect.deleteProperty(pending, token);
  });
}

export async function handleTelegramOfferCompletionAction(
  event: ActionEvent,
  identity: CompletionIdentity,
  initial?: { draftId: string; revision: number },
): Promise<void> {
  const { thread } = event;
  if (!thread) {
    return;
  }
  if (event.actionId === "osc" && initial) {
    const context = await authorizedContext({ ...initial, actorUserId: identity.actorUserId });
    const token = randomUUID().replaceAll("-", "");
    const prompt = await thread.post(buildTelegramOfferCompletionCard(context, token));
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      pending[token] = {
        actorUserId: identity.actorUserId,
        chatId: identity.chatId,
        draftId: context.draft.id,
        expiresAt: Date.now() + TELEGRAM_COMPLETION_TTL_MS,
        interviewRecordId: context.draft.interviewRecordId,
        organizationId: context.draft.organizationId,
        originMessageId: identity.messageId,
        promptMessageId: sentMessageId(prompt.id, identity.chatId),
        revision: initial.revision,
        status: "pending",
      };
    });
    return;
  }
  const token = event.value ?? "";
  if (event.actionId === "osx") {
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      pendingFor(pending, token, identity);
      Reflect.deleteProperty(pending, token);
    });
    await thread.post("已取消本次完成确认，Offer 状态未改变。");
    return;
  }
  const record = await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => ({
    ...pendingFor(pending, token, identity),
  }));
  let context: Awaited<ReturnType<typeof authorizedContext>>;
  try {
    context = await authorizedContext(record);
  } catch (error) {
    await removePending(thread, identity.chatId, token);
    throw error;
  }
  if (event.actionId === "osu") {
    const prompt = await thread.post(
      `请回复本条消息发送“${context.candidateName}”第 ${context.draft.version} 版 Offer 的一张审批截图（JPEG、PNG 或 WebP，最多 10 MB）。截图选填，发送后仍需点击原确认卡片的“确认内部审批已完成，并完成确认”。`,
    );
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      pendingFor(pending, token, identity).uploadPromptMessageId = sentMessageId(
        prompt.id,
        identity.chatId,
      );
    });
    return;
  }
  if (event.actionId !== "osf") {
    throw unavailable();
  }
  const claimed = await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
    const current = pendingFor(pending, token, identity);
    current.status = "completing";
    return { ...current };
  });
  let draft: Awaited<ReturnType<typeof completeOfferSscWithScreenshot>>;
  try {
    let file: File | undefined;
    if (claimed.screenshot) {
      try {
        file = await downloadTelegramOfferScreenshot(claimed.screenshot);
      } catch {
        throw new OfferDraftError("审批截图下载失败或超过 10 MB，请重新上传后重试。", 400);
      }
    }
    draft = await completeOfferSscWithScreenshot({
      actor: { id: identity.actorUserId, role: context.actorRole },
      draftId: claimed.draftId,
      internalApprovalConfirmed: true,
      interviewRecordId: claimed.interviewRecordId,
      organizationId: claimed.organizationId,
      revision: claimed.revision,
      source: "telegram",
      ...(file ? { file } : {}),
    });
  } catch (error) {
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      const current = pending[token];
      if (current?.status === "completing") {
        current.status = "pending";
      }
    });
    throw error;
  }
  try {
    await removePending(thread, identity.chatId, token);
  } catch {
    // The Offer already committed. Keep the durable "completing" claim until expiry.
    console.warn("[telegram-offer-ssc] Offer completed but confirmation state cleanup failed");
  }
  await updateTelegramOfferMessages(event, buildTelegramOfferCard({ ...context, draft }), [
    event.messageId,
    ...(claimed.originMessageId ? [`${identity.chatId}:${claimed.originMessageId}`] : []),
  ]);
}

function imageReference(
  raw: z.infer<typeof privateImageMessage>,
): TelegramScreenshotReference | null {
  const photo = raw.photo?.at(-1);
  if (photo) {
    return {
      fileId: photo.file_id,
      filename: "approval-screenshot.jpg",
      mediaType: "image/jpeg",
      size: photo.file_size,
    };
  }
  const { document } = raw;
  if (!document) {
    return null;
  }
  const mediaType = document.mime_type;
  const filename = (document.file_name ?? "").split(/[\\/]/u).pop() ?? "";
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (
    (mediaType === "image/jpeg" && (extension === "jpg" || extension === "jpeg")) ||
    (mediaType === "image/png" && extension === "png") ||
    (mediaType === "image/webp" && extension === "webp")
  ) {
    return {
      fileId: document.file_id,
      filename: filename.slice(0, 255),
      mediaType,
      size: document.file_size,
    };
  }
  throw new OfferDraftError("请选择 JPEG、PNG 或 WebP 审批截图，最多 10 MB。", 400);
}

function screenshotReply(raw: z.infer<typeof privateImageMessage>, message: Message) {
  const chatId = String(raw.chat.id);
  const replyId = raw.reply_to_message?.message_id;
  if (!replyId || message.replyTo?.id !== `${chatId}:${replyId}`) {
    throw unavailable();
  }
  const screenshot = imageReference(raw);
  if (!screenshot) {
    throw new OfferDraftError("请回复指定提示消息发送 JPEG、PNG 或 WebP 图片。", 400);
  }
  if (screenshot.size && screenshot.size > MAX_TELEGRAM_SCREENSHOT_BYTES) {
    throw new OfferDraftError("审批截图不能超过 10 MB。", 400);
  }
  return { chatId, replyId, screenshot };
}

async function bindScreenshotReply(
  thread: CompletionThread,
  chatId: string,
  replyId: number,
  screenshot: TelegramScreenshotReference,
) {
  return await withTelegramOfferCompletionState(thread, chatId, (pending) => {
    const matched = Object.entries(pending).filter(
      ([, current]) =>
        current.chatId === chatId &&
        current.uploadPromptMessageId === replyId &&
        current.status === "pending",
    );
    if (matched.length !== 1) {
      throw unavailable();
    }
    const [[token, current]] = matched;
    current.screenshot = screenshot;
    return [token, { ...current }] as const;
  });
}

async function reportScreenshotError(
  thread: CompletionThread,
  chatId: string,
  token: string | undefined,
  error: unknown,
) {
  if (token) {
    const stillPending = await withTelegramOfferCompletionState(thread, chatId, (pending) => {
      if (pending[token]?.status !== "pending") {
        return false;
      }
      Reflect.deleteProperty(pending, token);
      return true;
    });
    if (!stillPending) {
      return;
    }
  }
  await thread.post(
    error instanceof OfferDraftError ? error.message : "暂时无法处理审批截图，请稍后重试。",
  );
}

export async function handleTelegramOfferScreenshot(
  thread: CompletionThread,
  message: Message,
): Promise<boolean> {
  const parsed = privateImageMessage.safeParse(message.raw);
  if (
    !parsed.success ||
    (!parsed.data.photo?.length && !parsed.data.document && !message.attachments?.length)
  ) {
    return false;
  }
  const raw = parsed.data;
  if (raw.from.id !== raw.chat.id || raw.edit_date !== undefined || message.metadata.edited) {
    await thread.post("请使用本人账号回复指定截图提示，发送一张新的审批截图。");
    return true;
  }
  let selectedToken: string | undefined;
  const chatId = String(raw.chat.id);
  try {
    const { replyId, screenshot } = screenshotReply(raw, message);
    // Bind the exact reply's validated file reference before any identity or
    // Offer lookup can yield to a final click. Finalization rechecks all access.
    const [token, record] = await bindScreenshotReply(thread, chatId, replyId, screenshot);
    selectedToken = token;
    const actorUserId = await resolveBoundTelegramOfferActor({
      telegramUserId: String(raw.from.id),
      username: raw.from.username,
    });
    if (!actorUserId || actorUserId !== record.actorUserId) {
      throw new OfferDraftError("请先绑定本人 TG 账号后重试。", 403);
    }
    await authorizedContext(record);
    const awaitingConfirmation = await withTelegramOfferCompletionState(
      thread,
      chatId,
      (pending) =>
        pending[token]?.status === "pending" &&
        pending[token]?.screenshot?.fileId === screenshot.fileId,
    );
    if (!awaitingConfirmation) {
      return true;
    }
    await thread.post(
      "已选择审批截图，确认时将保存到对应 Offer。请点击原确认卡片的“确认内部审批已完成，并完成确认”；发送截图不会自动完成确认。",
    );
  } catch (error) {
    await reportScreenshotError(thread, chatId, selectedToken, error);
  }
  return true;
}
