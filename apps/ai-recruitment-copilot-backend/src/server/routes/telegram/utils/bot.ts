import { createPostgresState } from "@chat-adapter/state-pg";
import { createOfferTelegramAdapter } from "./offer-telegram-adapter";
import type { TelegramAdapter, TelegramMessage } from "@chat-adapter/telegram";
import { Chat } from "chat";
import type { AdapterPostableMessage } from "chat";
import { bindTelegramUser } from "../dao";

type TelegramBot = Chat<{ telegram: TelegramAdapter }>;

let cached: { adapter: TelegramAdapter; bot: TelegramBot } | null = null;

function getRequiredEnv(
  name: "DATABASE_URL" | "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET_TOKEN",
): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Telegram bot`);
  }
  return value;
}

function bindingReply(result: Awaited<ReturnType<typeof bindTelegramUser>>): string {
  if (result.kind === "requester_bound") {
    const memberReply = result.memberName ? `同时已绑定成员信息：${result.memberName}。` : "";
    const ambiguousReply = result.memberAmbiguous
      ? "系统内有多个成员填写了相同的 TG 号，成员信息未绑定，请联系管理员处理。"
      : "";
    return `需求发起人通知绑定成功，无需登录系统。${memberReply}${ambiguousReply}`;
  }
  if (result.kind === "bound") {
    return `绑定成功，${result.userName}。候选人状态发生变化时，我会在这里通知你。`;
  }
  const ambiguousReply = result.memberAmbiguous
    ? "系统内有多个成员填写了相同的 TG 号，成员信息未绑定，请联系管理员处理。"
    : "";
  return `关注成功，你可以在这里接收通知。${ambiguousReply}`;
}

export function isTelegramBotConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim(),
  );
}

export function getTelegramBot(): TelegramBot {
  if (cached) {
    return cached.bot;
  }

  const adapter = createOfferTelegramAdapter({
    botToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
    mode: "webhook",
    secretToken: getRequiredEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN"),
    userName: process.env.TELEGRAM_BOT_USERNAME?.trim() || undefined,
  });
  const bot = new Chat({
    adapters: { telegram: adapter },
    concurrency: "queue",
    dedupeTtlMs: 600_000,
    state: createPostgresState({
      keyPrefix: "telegram",
      url: getRequiredEnv("DATABASE_URL"),
    }),
    userName: process.env.TELEGRAM_BOT_USERNAME?.trim() || "recruitment-bot",
  });

  bot.onSlashCommand("/start", async (event) => {
    const startPayload = event.text?.trim();
    if (startPayload?.startsWith("offer_")) {
      const { openTelegramOffer } = await import("./offer-ssc");
      await openTelegramOffer(event, startPayload.slice("offer_".length));
      return;
    }
    const message = event.raw as TelegramMessage;
    if (message.chat.type !== "private") {
      await event.channel.post("请私聊机器人并发送 /start 完成通知绑定。");
      return;
    }
    let result: Awaited<ReturnType<typeof bindTelegramUser>>;
    try {
      result = await bindTelegramUser({
        chatId: String(message.chat.id),
        username: message.from?.username,
      });
    } catch {
      console.error("[telegram-binding] binding_failed");
      await event.channel.post("通知绑定暂未成功，请稍后重新发送 /start；如仍失败，请联系管理员。");
      return;
    }
    const pendingReply = result.sscProvisioningPending
      ? "SSC 身份同步暂未完成，系统会在通知任务中重试；如持续未收到 Offer，请联系管理员。"
      : "";
    await event.channel.post(bindingReply(result) + pendingReply);
  });

  bot.onSlashCommand("/offer", async (event) => {
    const { openTelegramOffer } = await import("./offer-ssc");
    await openTelegramOffer(event, event.text?.trim() ?? "");
  });

  bot.onAction(["osr", "osc", "osf", "osu", "osx"], async (event) => {
    const { handleTelegramOfferAction } = await import("./offer-ssc");
    await handleTelegramOfferAction(event);
  });

  bot.onDirectMessage(async (thread, message) => {
    const { handleTelegramOfferScreenshot } = await import("./offer-ssc");
    if (await handleTelegramOfferScreenshot(thread, message)) {
      return;
    }
    await thread.post("发送 /start 即可关注并接收通知。");
  });

  cached = { adapter, bot };
  return bot;
}

export async function postTelegramDirectMessage(
  chatId: string,
  message: AdapterPostableMessage,
): Promise<void> {
  const bot = getTelegramBot();
  // Proactive notifications may run before this process receives any webhook.
  await bot.initialize();
  const threadId = await bot.getAdapter("telegram").openDM(chatId);
  await bot.thread(threadId).post(message);
}

export async function shutdownTelegramBot(): Promise<void> {
  if (!cached) {
    return;
  }
  await cached.bot.shutdown();
  cached = null;
}
