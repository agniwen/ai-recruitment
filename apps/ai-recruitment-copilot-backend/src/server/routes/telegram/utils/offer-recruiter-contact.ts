import { randomUUID } from "node:crypto";
import {
  Actions,
  Button,
  Card,
  CardText,
  Field,
  Fields,
  LinkButton,
  paragraph,
  root,
  stringifyMarkdown,
  text,
} from "chat";
import type { ActionEvent, Message } from "chat";
import { z } from "zod";
import { candidatePrivateTelegramSchema } from "@arc/shared/offer-recruiter-contact";
import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import {
  loadTelegramOfferRecruiterContactContext,
  submitOfferRecruiterContact,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-recruiter-contact";
import { OfferDraftError } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { updateTelegramOfferMessages } from "./offer-ssc-message";
import { postTelegramOfferRecruiterPrompt } from "./offer-recruiter-prompt";
import {
  TELEGRAM_RECRUITER_CONTACT_TTL_MS,
  withTelegramOfferRecruiterState,
} from "./offer-recruiter-state";
import type { TelegramOfferRecruiterPending } from "./offer-recruiter-state";

type ContactThread = NonNullable<ActionEvent["thread"]>;
interface ContactActor {
  telegramUserId: string;
  username: string;
}
const senderSchema = z.object({ id: z.number().int().positive(), username: z.string().min(1) });
const chatSchema = z.object({ id: z.number().int().positive(), type: z.literal("private") });
const callbackSchema = z.object({
  from: senderSchema,
  message: z.object({ chat: chatSchema, message_id: z.number().int().positive() }),
});
const textMessageSchema = z.object({
  chat: chatSchema,
  edit_date: z.number().optional(),
  from: senderSchema,
  message_id: z.number().int().positive(),
  reply_to_message: z.object({ message_id: z.number().int().positive() }).optional(),
  text: z.string().min(1),
});

function literal(value: string) {
  return stringifyMarkdown(root([paragraph([text(value)])])).replace(/\n$/u, "");
}

function callbackValue(context: Pick<OfferRecruiterContactState, "draftId" | "revision">) {
  return `${context.draftId.replaceAll("-", "")}:${context.revision.toString(36)}`;
}

function parseCallback(value: string | undefined) {
  const match = /^([0-9a-f]{32}):([1-9a-z][0-9a-z]{0,5})$/u.exec(value ?? "");
  if (!match) {
    return null;
  }
  const [, compact, encoded] = match;
  const draftId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  const revision = Number.parseInt(encoded, 36);
  return z.uuid().safeParse(draftId).success &&
    revision <= 2_147_483_647 &&
    revision.toString(36) === encoded
    ? { draftId, revision }
    : null;
}

export function buildTelegramOfferRecruiterCard(context: OfferRecruiterContactState) {
  const pending = context.status === "pending" && context.canConfirm;
  const actions = pending
    ? [
        Button({
          id: "orc",
          label: context.candidatePrivateTelegram ? "修改候选人私人 TG" : "补充候选人私人 TG",
          value: callbackValue(context),
        }),
      ]
    : [];
  if (pending && context.candidatePrivateTelegram) {
    actions.push(Button({ id: "ors", label: "确认并提交 SSC", value: callbackValue(context) }));
  }
  return Card({
    children: [
      CardText(
        context.status === "completed"
          ? "已提交 SSC，系统将推送 Offer 通知。"
          : "ODC 已生成 Offer。请补充并核对候选人的私人 TG，确认后再交给 SSC 处理。",
      ),
      Fields([
        Field({ label: "候选人", value: literal(context.candidateName) }),
        Field({ label: "岗位", value: literal(context.position || "未填写") }),
        Field({ label: "Offer 版本", value: String(context.version) }),
        Field({ label: "招聘人员", value: literal(context.recruiterName || "未关联") }),
        Field({
          label: "候选人私人 TG",
          value: literal(context.candidatePrivateTelegram || "待补充"),
        }),
      ]),
      ...(actions.length ? [Actions(actions)] : []),
      ...(context.candidateDetailUrl
        ? [Actions([LinkButton({ label: "查看候选人详情", url: context.candidateDetailUrl })])]
        : []),
    ],
    title:
      context.status === "completed" ? "候选人私人 TG 已确认" : "Offer 已生成，请补充候选人私人 TG",
  });
}

function unavailable() {
  return new OfferDraftError(
    "本次候选人 TG 确认已过期或已处理，请从最新 Offer 卡片重新打开。",
    409,
  );
}
function replyError(error: unknown) {
  return error instanceof OfferDraftError
    ? error.message
    : "暂时无法处理候选人 TG，请稍后从最新 Offer 卡片重新打开。";
}
function requirePending(context: OfferRecruiterContactState, revision: number) {
  if (context.revision !== revision) {
    throw new OfferDraftError("Offer 内容已更新，请从最新卡片重新打开。", 409);
  }
  if (!context.canConfirm || context.status !== "pending") {
    throw new OfferDraftError("当前无法确认候选人 TG，请在系统核对招聘人员及 Offer 状态。", 403);
  }
}
function sameActor(record: TelegramOfferRecruiterPending, actor: ContactActor) {
  return (
    record.chatId === actor.telegramUserId &&
    record.telegramUsername === actor.username.toLowerCase()
  );
}
function messageId(value: string, chatId: string) {
  const match = /^(\d+):([1-9]\d*)$/u.exec(value);
  if (!match || match[1] !== chatId || !Number.isSafeInteger(Number(match[2]))) {
    throw unavailable();
  }
  return Number(match[2]);
}

async function openPrompt(
  thread: ContactThread,
  context: OfferRecruiterContactState,
  actor: ContactActor,
  sourceMessageId: number,
) {
  const token = randomUUID().replaceAll("-", "");
  await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
    const previous = Object.values(pending).find(
      (record) =>
        record.draftId === context.draftId &&
        record.revision === context.revision &&
        sameActor(record, actor) &&
        (record.reviewMessageId === sourceMessageId || record.originMessageId === sourceMessageId),
    );
    const originMessageId = previous?.originMessageId ?? sourceMessageId;
    for (const [key, record] of Object.entries(pending)) {
      if (record.draftId === context.draftId) {
        Reflect.deleteProperty(pending, key);
      }
    }
    pending[token] = {
      candidatePrivateTelegram: null,
      chatId: actor.telegramUserId,
      draftId: context.draftId,
      expiresAt: Date.now() + TELEGRAM_RECRUITER_CONTACT_TTL_MS,
      interviewRecordId: context.interviewRecordId,
      organizationId: context.organizationId,
      originMessageId,
      phase: "opening",
      revision: context.revision,
      telegramUsername: actor.username.toLowerCase(),
    };
  });
  try {
    const prompt = await postTelegramOfferRecruiterPrompt(
      thread,
      `ODC 已生成“${context.candidateName}”的 Offer v${context.version}。请回复本条消息发送候选人的私人 TG（例如 @candidate_name）。收到后会先请你核对，点击“确认并提交 SSC”后才会交给 SSC。`,
    );
    await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
      const record = pending[token];
      if (!record || record.phase !== "opening") {
        return;
      }
      record.promptMessageId = messageId(prompt, actor.telegramUserId);
      record.phase = "input";
    });
  } catch (error) {
    await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
      Reflect.deleteProperty(pending, token);
    });
    throw error;
  }
}

async function submitReview(event: ActionEvent, actor: ContactActor, token: string) {
  const { thread } = event;
  if (!thread) {
    throw unavailable();
  }
  const record = await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
    const current = pending[token];
    if (
      !current ||
      current.phase !== "review" ||
      !sameActor(current, actor) ||
      !current.candidatePrivateTelegram ||
      current.reviewMessageId !== messageId(event.messageId, actor.telegramUserId)
    ) {
      throw unavailable();
    }
    current.phase = "submitting";
    return { ...current };
  });
  let completed: OfferRecruiterContactState;
  try {
    const context = await loadTelegramOfferRecruiterContactContext({
      draftId: record.draftId,
      telegramActor: actor,
    });
    if (context.revision !== record.revision) {
      throw new OfferDraftError("Offer 内容已更新，请从最新卡片重新打开。", 409);
    }
    if (context.status === "completed") {
      completed = context;
    } else {
      requirePending(context, record.revision);
      completed = await submitOfferRecruiterContact({
        candidatePrivateTelegram: record.candidatePrivateTelegram ?? "",
        draftId: record.draftId,
        interviewRecordId: record.interviewRecordId,
        organizationId: record.organizationId,
        revision: record.revision,
        source: "telegram",
        telegramActor: actor,
      });
    }
  } catch (error) {
    await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
      if (pending[token]?.phase === "submitting") {
        pending[token].phase = "review";
      }
    });
    throw error;
  }
  return completed;
}

export async function handleTelegramOfferRecruiterAction(event: ActionEvent): Promise<void> {
  const parsed = callbackSchema.safeParse(event.raw);
  if (
    !parsed.success ||
    parsed.data.from.id !== parsed.data.message.chat.id ||
    !event.thread ||
    event.thread.id !== `telegram:${parsed.data.from.id}`
  ) {
    await event.thread?.post("请使用本人账号私聊机器人补充候选人 TG。");
    return;
  }
  const actor = {
    telegramUserId: String(parsed.data.from.id),
    username: parsed.data.from.username,
  };
  try {
    if (!["orc", "ors"].includes(event.actionId)) {
      throw unavailable();
    }
    const initial = parseCallback(event.value);
    let completed: OfferRecruiterContactState;
    if (initial) {
      const context = await loadTelegramOfferRecruiterContactContext({
        draftId: initial.draftId,
        telegramActor: actor,
      });
      if (context.revision !== initial.revision) {
        throw new OfferDraftError("Offer 内容已更新，请从最新卡片重新打开。", 409);
      }
      if (context.status === "completed") {
        completed = context;
      } else {
        requirePending(context, initial.revision);
        if (event.actionId === "orc") {
          await openPrompt(event.thread, context, actor, parsed.data.message.message_id);
          return;
        }
        const candidate = candidatePrivateTelegramSchema.safeParse(
          context.candidatePrivateTelegram,
        );
        if (!candidate.success) {
          throw new OfferDraftError("请先补充候选人的私人 TG，再确认并提交 SSC。", 400);
        }
        completed = await submitOfferRecruiterContact({
          candidatePrivateTelegram: candidate.data,
          draftId: context.draftId,
          interviewRecordId: context.interviewRecordId,
          organizationId: context.organizationId,
          revision: context.revision,
          source: "telegram",
          telegramActor: actor,
        });
      }
    } else {
      if (event.actionId !== "ors" || !/^[0-9a-f]{32}$/u.test(event.value ?? "")) {
        throw unavailable();
      }
      completed = await submitReview(event, actor, event.value ?? "");
    }
    const relatedMessageIds = await withTelegramOfferRecruiterState(
      event.thread,
      actor.telegramUserId,
      (pending) =>
        Object.values(pending)
          .filter((record) => record.draftId === completed.draftId && sameActor(record, actor))
          .flatMap((record) =>
            [record.originMessageId, record.reviewMessageId]
              .filter((id): id is number => id !== undefined)
              .map((id) => `${actor.telegramUserId}:${id}`),
          ),
    ).catch(() => [] as string[]);
    await updateTelegramOfferMessages(event, buildTelegramOfferRecruiterCard(completed), [
      event.messageId,
      ...relatedMessageIds,
    ]);
    await withTelegramOfferRecruiterState(event.thread, actor.telegramUserId, (pending) => {
      for (const [token, record] of Object.entries(pending)) {
        if (record.draftId === completed.draftId) {
          Reflect.deleteProperty(pending, token);
        }
      }
    }).catch(() => console.warn("[telegram-offer-recruiter] Could not clear submitted prompt"));
    await event.thread
      .post("候选人私人 TG 已确认并已提交 SSC，系统将推送 Offer 通知。")
      .catch(() =>
        console.warn("[telegram-offer-recruiter] Could not deliver submitted acknowledgement"),
      );
  } catch (error) {
    await event.thread.post(replyError(error));
  }
}

export async function handleTelegramOfferRecruiterMessage(
  thread: ContactThread,
  message: Message,
): Promise<boolean> {
  const parsed = textMessageSchema.safeParse(message.raw);
  if (
    !parsed.success ||
    parsed.data.from.id !== parsed.data.chat.id ||
    thread.id !== `telegram:${parsed.data.chat.id}`
  ) {
    return false;
  }
  const raw = parsed.data;
  const actor = { telegramUserId: String(raw.from.id), username: raw.from.username };
  const replyId = raw.reply_to_message?.message_id;
  const candidates = await withTelegramOfferRecruiterState(
    thread,
    actor.telegramUserId,
    (pending) =>
      Object.entries(pending)
        .filter(([, record]) => record.phase === "input" && record.chatId === actor.telegramUserId)
        .map(([token, record]) => ({ record: { ...record }, token })),
  );
  if (!candidates.length) {
    return false;
  }
  const matches = replyId
    ? candidates.filter(({ record }) => record.promptMessageId === replyId)
    : candidates;
  if (
    matches.length !== 1 ||
    (replyId && message.replyTo?.id !== `${actor.telegramUserId}:${replyId}`) ||
    (!replyId && message.replyTo)
  ) {
    await thread.post(
      "请回复目标候选人的最新 TG 补充提示，再发送私人 TG；有多个待补充 Offer 时请先选择对应提示。",
    );
    return true;
  }
  const [{ token, record }] = matches;
  try {
    if (raw.edit_date !== undefined || message.metadata.edited || !sameActor(record, actor)) {
      throw new OfferDraftError("请使用原账号回复最新提示，发送一条新的候选人私人 TG。", 403);
    }
    const candidate = candidatePrivateTelegramSchema.safeParse(raw.text);
    if (!candidate.success) {
      throw new OfferDraftError("请填写有效的候选人私人 TG 用户名，例如 @candidate_name。", 400);
    }
    const context = await loadTelegramOfferRecruiterContactContext({
      draftId: record.draftId,
      telegramActor: actor,
    });
    requirePending(context, record.revision);
    await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
      const current = pending[token];
      if (
        !current ||
        current.phase !== "input" ||
        !sameActor(current, actor) ||
        current.promptMessageId !== record.promptMessageId
      ) {
        throw unavailable();
      }
      current.candidatePrivateTelegram = candidate.data;
      current.phase = "review";
    });
    try {
      const review = await thread.post(
        Card({
          children: [
            CardText(
              literal(
                `候选人：${context.candidateName}\nOffer 版本：${context.version}\n候选人私人 TG：${candidate.data}`,
              ),
            ),
            CardText("此时尚未提交 SSC。请核对后点击确认；如需修改，请重新填写。"),
            Actions([
              Button({ id: "ors", label: "确认并提交 SSC", value: token }),
              Button({ id: "orc", label: "重新填写", value: callbackValue(context) }),
            ]),
            ...(context.candidateDetailUrl
              ? [
                  Actions([
                    LinkButton({ label: "查看候选人详情", url: context.candidateDetailUrl }),
                  ]),
                ]
              : []),
          ],
          title: "核对候选人私人 TG",
        }),
      );
      await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
        const current = pending[token];
        if (current?.phase === "review" && current.candidatePrivateTelegram === candidate.data) {
          current.reviewMessageId = messageId(review.id, actor.telegramUserId);
        }
      });
    } catch (error) {
      await withTelegramOfferRecruiterState(thread, actor.telegramUserId, (pending) => {
        const current = pending[token];
        if (current?.phase === "review" && !current.reviewMessageId) {
          current.phase = "input";
          current.candidatePrivateTelegram = null;
        }
      });
      throw error;
    }
  } catch (error) {
    await thread.post(replyError(error));
  }
  return true;
}
