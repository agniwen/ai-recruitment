import { randomUUID } from "node:crypto";
import type { ActionEvent, Message } from "chat";
import { z } from "zod";
import { completeOfferSscWithScreenshot } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-completion";
import {
  loadAuthorizedOfferSscContext,
  OfferDraftError,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";

import type { OfferSscTelegramActor } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import {
  describeOfferSscOperator,
  loadOfferSscActivity,
  recordOfferSscInteraction,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-activity";
import { loadOfferSscInterviewSummary } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-interview-summary";
import { getTelegramBot } from "./bot";
import { buildTelegramOfferCompletionCard } from "./offer-ssc-card";
import { buildOfferCandidatePreviewLink } from "@arc/ai-recruitment-copilot-backend/server/routes/public/routes/offer-candidates/access";
import { buildTelegramOfferPublicCard } from "./offer-ssc-public-card";
import { updateTelegramOfferMessages } from "./offer-ssc-message";
import { downloadTelegramOfferScreenshot } from "./offer-ssc-screenshot";
import { postTelegramOfferScreenshotPrompt } from "./offer-ssc-upload-prompt";
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
  actor: OfferSscTelegramActor;
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
    (record.telegramUsername !== undefined &&
      record.telegramUsername !== identity.actor.username.toLowerCase()) ||
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
  record: Pick<TelegramOfferCompletionPending, "draftId" | "revision" | "preboardingDate">,
  actor: OfferSscTelegramActor,
) {
  const context = await loadAuthorizedOfferSscContext({
    draftId: record.draftId,
    telegramActor: actor,
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
  if (!context.draft.preboardingDate) {
    throw new OfferDraftError("请先完成预入职时间确认并录入预入职日期。", 409);
  }
  if (record.preboardingDate && record.preboardingDate !== context.draft.preboardingDate) {
    throw new OfferDraftError("预入职日期已更新，请重新打开完成确认并核对新日期。", 409);
  }
  const [activity, interviewRounds] = await Promise.all([
    loadOfferSscActivity(context.draft),
    loadOfferSscInterviewSummary({
      interviewRecordId: context.draft.interviewRecordId,
      organizationId: context.draft.organizationId,
    }),
  ]);
  return { ...context, activity, interviewRounds, telegramActor: actor };
}

function completionDetailUrl(context: Awaited<ReturnType<typeof authorizedContext>>) {
  return buildOfferCandidatePreviewLink({
    candidateId: context.draft.interviewRecordId,
    draftId: context.draft.id,
    organizationId: context.draft.organizationId,
    revision: context.draft.sscRevision ?? 1,
    telegramActor: context.telegramActor,
  });
}

async function removePending(thread: CompletionThread, chatId: string, token: string) {
  await withTelegramOfferCompletionState(thread, chatId, (pending) => {
    Reflect.deleteProperty(pending, token);
  });
}

async function clearCompletionOpening(
  thread: CompletionThread,
  chatId: string,
  draftId: string,
  token: string,
) {
  await withTelegramOfferCompletionState(thread, chatId, (_pending, openings) => {
    if (openings[draftId]?.token === token) {
      Reflect.deleteProperty(openings, draftId);
    }
  });
}

async function registerDeliveredCompletion(
  thread: CompletionThread,
  token: string,
  record: TelegramOfferCompletionPending,
) {
  return await withTelegramOfferCompletionState(thread, record.chatId, (pending, openings) => {
    if (
      openings[record.draftId]?.token !== token ||
      openings[record.draftId]?.revision !== record.revision
    ) {
      return false;
    }
    // A newer opening reserves a different token before posting. An older SDK
    // receipt can never replace that opening, its card, or an uploaded screenshot.
    for (const [key, current] of Object.entries(pending)) {
      if (current.draftId === record.draftId && current.status === "pending") {
        Reflect.deleteProperty(pending, key);
      }
    }
    pending[token] = record;
    Reflect.deleteProperty(openings, record.draftId);
    return true;
  });
}

export async function openTelegramOfferCompletionSession(input: {
  actor: OfferSscTelegramActor;
  draftId: string;
  originMessageId: number;
  revision: number;
  thread: CompletionThread;
}): Promise<string> {
  const { actor, originMessageId, thread } = input;
  if (
    thread.id !== `telegram:${actor.telegramUserId}` ||
    !z.uuid().safeParse(input.draftId).success ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isSafeInteger(originMessageId) ||
    originMessageId < 1
  ) {
    throw unavailable();
  }
  const token = randomUUID().replaceAll("-", "");
  const expiresAt = Date.now() + TELEGRAM_COMPLETION_TTL_MS;
  // Reserve at entry, before any asynchronous permission read or message post.
  // This CAS token orders openings even when their timestamps are identical.
  await withTelegramOfferCompletionState(thread, actor.telegramUserId, (_pending, openings) => {
    openings[input.draftId] = { expiresAt, revision: input.revision, token };
  });
  try {
    const context = await authorizedContext(input, actor);
    await recordOfferSscInteraction(context, "offer_ssc_confirmation_opened");
    const activity = await loadOfferSscActivity(context.draft);
    const prompt = await thread.post(
      buildTelegramOfferCompletionCard({ ...context, activity }, token, {
        detailUrl: completionDetailUrl(context),
        operatorLabel: describeOfferSscOperator(context.telegramOperator),
      }),
    );
    const registered = await registerDeliveredCompletion(thread, token, {
      chatId: actor.telegramUserId,
      draftId: context.draft.id,
      expiresAt,
      interviewRecordId: context.draft.interviewRecordId,
      organizationId: context.draft.organizationId,
      originMessageId,
      preboardingDate: context.draft.preboardingDate ?? undefined,
      promptMessageId: sentMessageId(prompt.id, actor.telegramUserId),
      revision: input.revision,
      status: "pending",
      telegramUsername: actor.username.toLowerCase(),
    });
    if (!registered) {
      await prompt.edit("这张确认卡已被更新，请使用最新确认卡完成操作。").catch(() => {
        console.warn("[telegram-offer-ssc] Superseded confirmation card could not be cleared");
      });
    }
  } catch (error) {
    await clearCompletionOpening(thread, actor.telegramUserId, input.draftId, token).catch(() => {
      console.warn("[telegram-offer-ssc] Failed opening reservation could not be cleared");
    });
    throw error;
  }
  return token;
}

async function beginCompletion(
  event: ActionEvent,
  identity: CompletionIdentity,
  initial: { draftId: string; revision: number },
) {
  const { thread } = event;
  if (!thread) {
    throw unavailable();
  }
  if (event.actionId === "osc") {
    return await openTelegramOfferCompletionSession({
      ...initial,
      actor: identity.actor,
      originMessageId: identity.messageId,
      thread,
    });
  }
  const context = await authorizedContext(initial, identity.actor);
  const token = randomUUID().replaceAll("-", "");
  return await withTelegramOfferCompletionState(thread, identity.chatId, (pending, openings) => {
    // Broadcast cards initialize their own private upload/confirmation session on first use.
    // Reuse it on retries; an older card must not bypass a newer screenshot confirmation.
    if (event.actionId !== "osc") {
      const existing = Object.entries(pending).find(
        ([, current]) =>
          current.draftId === initial.draftId &&
          current.revision === initial.revision &&
          current.originMessageId === identity.messageId,
      );
      if (existing) {
        pendingFor(pending, existing[0], identity);
        openings[initial.draftId] = {
          expiresAt: existing[1].expiresAt,
          revision: initial.revision,
          token: existing[0],
        };
        return existing[0];
      }
    }
    pending[token] = {
      chatId: identity.chatId,
      draftId: context.draft.id,
      expiresAt: Date.now() + TELEGRAM_COMPLETION_TTL_MS,
      interviewRecordId: context.draft.interviewRecordId,
      organizationId: context.draft.organizationId,
      originMessageId: identity.messageId,
      preboardingDate: context.draft.preboardingDate ?? undefined,
      promptMessageId: identity.messageId,
      revision: initial.revision,
      status: "pending",
      telegramUsername: identity.actor.username.toLowerCase(),
    };
    openings[initial.draftId] = {
      expiresAt: pending[token].expiresAt,
      revision: initial.revision,
      token,
    };
    return token;
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
    await beginCompletion(event, identity, initial);
    return;
  }
  const token = initial ? await beginCompletion(event, identity, initial) : (event.value ?? "");
  const record = await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => ({
    ...pendingFor(pending, token, identity),
  }));
  let context: Awaited<ReturnType<typeof authorizedContext>>;
  try {
    context = await authorizedContext(record, identity.actor);
  } catch (error) {
    await removePending(thread, identity.chatId, token);
    throw error;
  }
  if (initial && event.actionId === "osf") {
    const prompt = await thread.post(
      buildTelegramOfferCompletionCard(context, token, {
        detailUrl: completionDetailUrl(context),
        operatorLabel: describeOfferSscOperator(context.telegramOperator),
      }),
    );
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      pendingFor(pending, token, identity).promptMessageId = sentMessageId(
        prompt.id,
        identity.chatId,
      );
    });
    return;
  }
  if (event.actionId === "osx") {
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      pendingFor(pending, token, identity);
      Reflect.deleteProperty(pending, token);
    });
    await recordOfferSscInteraction(context, "offer_ssc_confirmation_cancelled");
    await thread.post(
      `${describeOfferSscOperator(context.telegramOperator)}已取消本次完成确认，Offer 状态未改变。`,
    );
    return;
  }
  if (event.actionId === "osu") {
    const selectionId = randomUUID();
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      const selected = pendingFor(pending, token, identity);
      for (const current of Object.values(pending)) {
        if (current.chatId === identity.chatId) {
          Reflect.deleteProperty(current, "uploadPromptMessageId");
          Reflect.deleteProperty(current, "uploadSelectionId");
        }
      }
      selected.uploadSelectionId = selectionId;
    });
    const promptId = await postTelegramOfferScreenshotPrompt(
      thread,
      `操作人：${describeOfferSscOperator(context.telegramOperator)}。预入职日期：${context.draft.preboardingDate}。请回复本条消息发送“${context.candidateName}”第 ${context.draft.version} 版 Offer 的一张审批截图（JPEG、PNG 或 WebP，最多 10 MB）。截图选填，上传后会自动发送新的确认卡片，请点击其中的“确认完成”。`,
    );
    await withTelegramOfferCompletionState(thread, identity.chatId, (pending) => {
      if (pending[token]?.uploadSelectionId !== selectionId) {
        return;
      }
      const selected = pendingFor(pending, token, identity);
      selected.uploadPromptMessageId = sentMessageId(promptId, identity.chatId);
      Reflect.deleteProperty(selected, "uploadSelectionId");
    });
    await recordOfferSscInteraction(context, "offer_ssc_upload_requested");
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
      actor: identity.actor,
      draftId: claimed.draftId,
      expectedPreboardingDate:
        claimed.preboardingDate ?? context.draft.preboardingDate ?? undefined,
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
  const activity = await loadOfferSscActivity(draft);
  await updateTelegramOfferMessages(
    event,
    buildTelegramOfferPublicCard({ ...context, activity, draft }, identity.actor),
    [
      event.messageId,
      ...(claimed.originMessageId ? [`${identity.chatId}:${claimed.originMessageId}`] : []),
    ],
  );
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
  if (
    (replyId && message.replyTo?.id !== `${chatId}:${replyId}`) ||
    (!replyId && message.replyTo)
  ) {
    throw new OfferDraftError("请回复机器人最新的截图提示消息，再发送审批截图。", 400);
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
  replyId: number | undefined,
  screenshot: TelegramScreenshotReference,
) {
  return await withTelegramOfferCompletionState(thread, chatId, (pending) => {
    const matched = Object.entries(pending).filter(
      ([, current]) =>
        current.chatId === chatId &&
        current.uploadPromptMessageId !== undefined &&
        (replyId === undefined || current.uploadPromptMessageId === replyId) &&
        current.status === "pending",
    );
    if (matched.length !== 1) {
      throw new OfferDraftError("请先点击目标 Offer 的“上传截图”，再发送审批截图。", 400);
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

async function postScreenshotConfirmation(
  thread: CompletionThread,
  context: Awaited<ReturnType<typeof authorizedContext>>,
  token: string,
  record: TelegramOfferCompletionPending,
) {
  let prompt: Awaited<ReturnType<CompletionThread["post"]>>;
  try {
    prompt = await thread.post(
      buildTelegramOfferCompletionCard(context, token, {
        detailUrl: completionDetailUrl(context),
        operatorLabel: describeOfferSscOperator(context.telegramOperator),
        screenshotReceived: true,
      }),
    );
  } catch {
    await thread
      .post("审批截图已收到，新的确认按钮暂时发送失败，请点击原确认卡片的“确认完成”。")
      .catch(() =>
        console.warn(
          "[telegram-offer-ssc] Screenshot received but confirmation card delivery failed",
        ),
      );
    return;
  }
  let registered = false;
  try {
    registered = await withTelegramOfferCompletionState(thread, record.chatId, (pending) => {
      const current = pending[token];
      if (
        current?.status !== "pending" ||
        current.screenshot?.fileId !== record.screenshot?.fileId ||
        current.promptMessageId !== record.promptMessageId
      ) {
        return false;
      }
      current.promptMessageId = sentMessageId(prompt.id, record.chatId);
      return true;
    });
  } catch {
    // The state write may have committed before its acknowledgement failed.
    // Restore only this card's pointer without undoing a newer upload or final approval.
    const promptMayBeActive = await withTelegramOfferCompletionState(
      thread,
      record.chatId,
      (pending) => {
        const current = pending[token];
        if (
          current?.status === "pending" &&
          current.screenshot?.fileId === record.screenshot?.fileId &&
          current.promptMessageId === sentMessageId(prompt.id, record.chatId)
        ) {
          current.promptMessageId = record.promptMessageId;
        }
        return current?.promptMessageId === sentMessageId(prompt.id, record.chatId);
      },
    ).catch(() => {
      console.warn("[telegram-offer-ssc] Could not restore the previous confirmation card");
      return true;
    });
    if (promptMayBeActive) {
      return;
    }
    await thread
      .post(
        "审批截图已收到，确认卡片暂时更新失败，请从原确认卡片继续；如仍不可用，请从 Offer 重新打开。",
      )
      .catch(() =>
        console.warn("[telegram-offer-ssc] Could not deliver confirmation recovery guidance"),
      );
  }
  if (!registered) {
    await prompt
      .edit("本次截图确认提示已失效，请查看原 Offer 卡片的最新状态。")
      .catch(() =>
        console.warn(
          "[telegram-offer-ssc] Could not clear an inactive screenshot confirmation card",
        ),
      );
    return;
  }
  await getTelegramBot()
    .getAdapter("telegram")
    .editMessage(
      thread.id,
      `${record.chatId}:${record.promptMessageId}`,
      "审批截图已收到，请使用下方最新确认卡片的“确认完成”按钮。",
    )
    .catch(() =>
      console.warn("[telegram-offer-ssc] Could not clear the previous confirmation card"),
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
    const actor = { telegramUserId: String(raw.from.id), username: raw.from.username ?? "" };
    if (
      record.telegramUsername !== undefined &&
      record.telegramUsername !== actor.username.toLowerCase()
    ) {
      throw new OfferDraftError("TG 用户名已变更，请从 Offer 重新打开确认。", 403);
    }
    const context = await authorizedContext(record, actor);
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
    await recordOfferSscInteraction(context, "offer_ssc_screenshot_uploaded");
    const activity = await loadOfferSscActivity(context.draft);
    await postScreenshotConfirmation(thread, { ...context, activity }, token, record);
  } catch (error) {
    await reportScreenshotError(thread, chatId, selectedToken, error);
  }
  return true;
}
