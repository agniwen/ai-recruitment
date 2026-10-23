import { randomUUID } from "node:crypto";
import type { ActionEvent, Message } from "chat";
import { z } from "zod";
import { offerPreboardingDateSchema } from "@arc/shared/offer-preboarding";
import { candidatePrivateTelegramSchema } from "@arc/shared/offer-recruiter-contact";
import {
  confirmOfferPreboardingDate,
  loadAuthorizedOfferSscContext,
  OfferDraftError,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import type { OfferSscTelegramActor } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { loadOfferSscActivity } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-activity";
import { loadOfferSscInterviewSummary } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-interview-summary";
import { buildTelegramOfferPublicCard } from "./offer-ssc-public-card";
import { getTelegramBot } from "./bot";
import { postTelegramOfferPreboardingPrompt } from "./offer-ssc-preboarding-prompt";
import { openTelegramOfferCompletionSession } from "./offer-ssc-completion";
import {
  TELEGRAM_PREBOARDING_TTL_MS,
  withTelegramPreboardingState,
} from "./offer-ssc-preboarding-state";

type PreboardingThread = NonNullable<ActionEvent["thread"]>;
const inputSchema = z.object({
  chat: z.object({ id: z.number().int().positive(), type: z.literal("private") }),
  edit_date: z.number().optional(),
  from: z.object({ id: z.number().int().positive(), username: z.string().min(1) }),
  message_id: z.number().int().positive(),
  reply_to_message: z.object({ message_id: z.number().int().positive() }).optional(),
  text: z.string().min(1),
});

async function authorized(
  initial: { draftId: string; revision: number },
  actor: OfferSscTelegramActor,
) {
  const context = await loadAuthorizedOfferSscContext({
    draftId: initial.draftId,
    telegramActor: actor,
  });
  if (!context.canConfirm) {
    throw new OfferDraftError("没有 SSC 完成确认权限。", 403);
  }
  if (context.draft.sscRevision !== initial.revision) {
    throw new OfferDraftError("Offer 内容已更新，请从最新卡片重新打开。", 409);
  }
  if (context.draft.recruiterConfirmationStatus === "pending") {
    throw new OfferDraftError("请先由招聘人员补充并确认候选人私人 TG。", 409);
  }
  if (
    context.draft.status !== "draft" ||
    context.draft.sscConfirmationStatus !== "confirming" ||
    context.pipelineStage === "closed"
  ) {
    throw new OfferDraftError("请先完成 SSC 接收确认，并使用当前有效的 Offer。", 409);
  }
  return context;
}

export async function handleTelegramOfferPreboardingAction(
  event: ActionEvent,
  actor: OfferSscTelegramActor,
  initial: { draftId: string; revision: number },
  originMessageId: number,
): Promise<void> {
  const { thread } = event;
  if (!thread) {
    return;
  }
  const context = await authorized(initial, actor);
  const chatId = actor.telegramUserId;
  const prompt = await postTelegramOfferPreboardingPrompt(
    thread,
    `请在联系候选人后，录入“${context.candidateName}”第 ${context.draft.version} 版 Offer 的预入职日期。请回复本条消息，格式：YYYY-MM-DD，例如：2026-11-01。${context.draft.preboardingDate ? `当前记录：${context.draft.preboardingDate}。` : ""}保存后会同步系统 Offer，再继续完成确认。`,
  );
  const match = /^(\d+):(\d+)$/u.exec(prompt);
  if (
    !match ||
    match[1] !== chatId ||
    !Number.isSafeInteger(Number(match[2])) ||
    Number(match[2]) < 1
  ) {
    throw new OfferDraftError("日期提示无效，请重新点击预入职时间确认。", 409);
  }
  await withTelegramPreboardingState(thread, chatId, (pending) => {
    for (const [token, record] of Object.entries(pending)) {
      if (record.draftId === initial.draftId && record.revision === initial.revision) {
        Reflect.deleteProperty(pending, token);
      }
    }
    pending[randomUUID().replaceAll("-", "")] = {
      chatId,
      draftId: initial.draftId,
      expiresAt: Date.now() + TELEGRAM_PREBOARDING_TTL_MS,
      originMessageId,
      promptMessageId: Number(match[2]),
      revision: initial.revision,
      status: "pending",
      telegramUsername: actor.username.toLowerCase(),
    };
  });
}

function privatePreboardingInput(message: Message) {
  const parsed = inputSchema.safeParse(message.raw);
  if (!parsed.success) {
    return null;
  }
  const raw = parsed.data;
  if (raw.from.id !== raw.chat.id || raw.edit_date !== undefined || message.metadata.edited) {
    return null;
  }
  const chatId = String(raw.chat.id);
  const replyId = raw.reply_to_message?.message_id;
  if (!replyId && candidatePrivateTelegramSchema.safeParse(raw.text.trim()).success) {
    return null;
  }
  if (
    (replyId && message.replyTo?.id !== `${chatId}:${replyId}`) ||
    (!replyId && message.replyTo)
  ) {
    return null;
  }
  return raw;
}

export async function handleTelegramOfferPreboardingMessage(
  thread: PreboardingThread,
  message: Message,
): Promise<boolean> {
  const raw = privatePreboardingInput(message);
  if (!raw) {
    return false;
  }
  const chatId = String(raw.chat.id);
  const replyId = raw.reply_to_message?.message_id;
  const matches = await withTelegramPreboardingState(thread, chatId, (pending) =>
    Object.entries(pending).filter(
      ([, record]) =>
        record.chatId === chatId &&
        record.telegramUsername === raw.from.username.toLowerCase() &&
        record.status === "pending" &&
        (replyId === undefined || record.promptMessageId === replyId),
    ),
  );
  if (!matches.length) {
    return false;
  }
  if (matches.length !== 1) {
    await thread.post(
      "存在多个待填写日期的 Offer，请回复对应的预入职日期提示消息，格式：YYYY-MM-DD。",
    );
    return true;
  }
  const date = offerPreboardingDateSchema.safeParse(raw.text.trim());
  if (!date.success) {
    await thread.post("请输入有效的预入职日期，格式：YYYY-MM-DD，例如：2026-11-01。");
    return true;
  }
  const [[token, record]] = matches;
  const actor = { telegramUserId: chatId, username: raw.from.username };
  try {
    const context = await authorized(record, actor);
    const claimed = await withTelegramPreboardingState(thread, chatId, (pending) => {
      if (
        pending[token]?.status !== "pending" ||
        pending[token]?.promptMessageId !== record.promptMessageId
      ) {
        return false;
      }
      pending[token].status = "saving";
      return true;
    });
    if (!claimed) {
      await thread.post("该日期正在保存，请查看最新 Offer 状态。");
      return true;
    }
    let draft: Awaited<ReturnType<typeof confirmOfferPreboardingDate>>;
    try {
      draft = await confirmOfferPreboardingDate({
        actor,
        draftId: record.draftId,
        interviewRecordId: context.draft.interviewRecordId,
        organizationId: context.draft.organizationId,
        preboardingDate: date.data,
        revision: record.revision,
        source: "telegram",
      });
    } catch (error) {
      await withTelegramPreboardingState(thread, chatId, (pending) => {
        if (pending[token]?.status === "saving") {
          pending[token].status = "pending";
        }
      });
      throw error;
    }
    await withTelegramPreboardingState(thread, chatId, (pending) => {
      Reflect.deleteProperty(pending, token);
    }).catch(() => {
      console.warn("[telegram-offer-preboarding] Date saved but input state cleanup failed");
    });
    try {
      const [activity, interviewRounds] = await Promise.all([
        loadOfferSscActivity(draft),
        loadOfferSscInterviewSummary({
          interviewRecordId: draft.interviewRecordId,
          organizationId: draft.organizationId,
        }),
      ]);
      const card = buildTelegramOfferPublicCard(
        { ...context, activity, draft, interviewRounds },
        actor,
      );
      try {
        await getTelegramBot()
          .getAdapter("telegram")
          .editMessage(thread.id, `${chatId}:${record.originMessageId}`, card);
      } catch {
        await thread.post(card);
      }
    } catch {
      // Saving a date must not be reported as failed because a card refresh failed.
      console.warn("[telegram-offer-preboarding] Date saved but card refresh failed");
    }
    await thread
      .post(
        `预入职日期已保存：${draft.preboardingDate}，已同步系统 Offer。请继续完成确认，审批截图仍可上传。`,
      )
      .catch(() => {
        console.warn("[telegram-offer-preboarding] Date saved but receipt delivery failed");
      });
    await openTelegramOfferCompletionSession({
      actor,
      draftId: draft.id,
      originMessageId: record.originMessageId,
      revision: record.revision,
      thread,
    }).catch(() => {
      console.warn("[telegram-offer-preboarding] Date saved but completion card could not open");
    });
  } catch (error) {
    await thread.post(
      error instanceof OfferDraftError ? error.message : "暂时无法保存预入职日期，请稍后重试。",
    );
  }
  return true;
}
