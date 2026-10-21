import type { ActionEvent, SlashCommandEvent } from "chat";
import { z } from "zod";
import {
  loadAuthorizedOfferSscContext,
  OfferDraftError,
  receiveOfferSscConfirmation,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";

import { buildTelegramOfferPublicCard } from "./offer-ssc-public-card";
import { handleTelegramOfferCompletionAction } from "./offer-ssc-completion";
import { updateTelegramOfferMessages } from "./offer-ssc-message";
export { handleTelegramOfferScreenshot } from "./offer-ssc-completion";

const telegramSender = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
});
const privateChat = z.object({ id: z.number().int().positive(), type: z.literal("private") });
const commandMessage = z.object({ chat: privateChat, from: telegramSender });
const callbackQuery = z.object({
  from: telegramSender,
  message: z.object({ chat: privateChat, message_id: z.number().int().positive() }),
});
const MAX_REVISION = 2_147_483_647;

function parseCallback(value: string | undefined) {
  const match = /^([0-9a-f]{32}):([1-9a-z][0-9a-z]{0,5})$/u.exec(value ?? "");
  if (!match) {
    return null;
  }
  const [, compact, encodedRevision] = match;
  const draftId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  const revision = Number.parseInt(encodedRevision, 36);
  if (
    !z.uuid().safeParse(draftId).success ||
    revision < 1 ||
    revision > MAX_REVISION ||
    revision.toString(36) !== encodedRevision
  ) {
    return null;
  }
  return { draftId, revision };
}

function errorReply(error: unknown): string {
  return error instanceof OfferDraftError
    ? error.message
    : "暂时无法处理 Offer，请稍后重新打开或重试。";
}

export async function openTelegramOffer(event: SlashCommandEvent, draftId: string): Promise<void> {
  const message = commandMessage.safeParse(event.raw);
  if (!message.success || message.data.from.id !== message.data.chat.id) {
    await event.channel.post("请使用本人账号私聊机器人处理 Offer。");
    return;
  }
  if (!z.uuid().safeParse(draftId).success) {
    await event.channel.post("Offer 链接无效，请从系统重新打开。");
    return;
  }
  try {
    const actor = {
      telegramUserId: String(message.data.from.id),
      username: message.data.from.username,
    };
    const context = await loadAuthorizedOfferSscContext({ draftId, telegramActor: actor });
    await event.channel.post(buildTelegramOfferPublicCard(context, actor));
  } catch (error) {
    await event.channel.post(errorReply(error));
  }
}

export async function handleTelegramOfferAction(event: ActionEvent): Promise<void> {
  const callback = callbackQuery.safeParse(event.raw);
  if (
    !callback.success ||
    callback.data.from.id !== callback.data.message.chat.id ||
    !event.thread
  ) {
    await event.thread?.post("请使用本人账号私聊机器人处理 Offer。");
    return;
  }
  const supportedAction = ["osr", "osc", "osf", "osu", "osx"].includes(event.actionId);
  const initialAction =
    ["osr", "osc"].includes(event.actionId) || Boolean(event.value?.includes(":"));
  const parsed = initialAction ? parseCallback(event.value) : null;
  if (
    !supportedAction ||
    (initialAction && !parsed) ||
    (!initialAction &&
      (!["osf", "osu", "osx"].includes(event.actionId) ||
        !/^[0-9a-f]{32}$/u.test(event.value ?? "")))
  ) {
    await event.thread.post("Offer 操作无效，请从系统重新打开。");
    return;
  }
  try {
    const actor = {
      telegramUserId: String(callback.data.from.id),
      username: callback.data.from.username,
    };
    if (event.actionId !== "osr") {
      await handleTelegramOfferCompletionAction(
        event,
        {
          actor,
          chatId: String(callback.data.message.chat.id),
          messageId: callback.data.message.message_id,
        },
        parsed ?? undefined,
      );
      return;
    }
    if (!parsed) {
      return;
    }
    const context = await loadAuthorizedOfferSscContext({
      draftId: parsed.draftId,
      telegramActor: actor,
    });
    const draft = await receiveOfferSscConfirmation({
      actor,
      draftId: parsed.draftId,
      interviewRecordId: context.draft.interviewRecordId,
      organizationId: context.draft.organizationId,
      revision: parsed.revision,
      source: "telegram",
    });
    await updateTelegramOfferMessages(
      event,
      buildTelegramOfferPublicCard({ ...context, draft }, actor),
    );
  } catch (error) {
    await event.thread.post(errorReply(error));
  }
}
