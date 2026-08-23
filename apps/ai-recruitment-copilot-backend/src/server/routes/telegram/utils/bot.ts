import { createPostgresState } from "@chat-adapter/state-pg";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import type { TelegramAdapter, TelegramMessage } from "@chat-adapter/telegram";
import { Chat } from "chat";
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
  if (result.kind === "bound") {
    return `绑定成功，${result.userName}。候选人状态发生变化时，我会在这里通知你。`;
  }
  if (result.kind === "missing_username") {
    return "绑定失败：你的 Telegram 账号尚未设置用户名，请设置后重新发送 /start。";
  }
  if (result.kind === "ambiguous") {
    return "绑定失败：系统内有多个成员填写了相同的 TG 号，请联系管理员处理。";
  }
  return "未找到与你的 Telegram 用户名一致的成员信息。请先在个人信息中填写 TG 号，再发送 /start。";
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

  const adapter = createTelegramAdapter({
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
    const message = event.raw as TelegramMessage;
    if (message.chat.type !== "private") {
      await event.channel.post("请私聊机器人并发送 /start 完成通知绑定。");
      return;
    }
    const result = await bindTelegramUser({
      chatId: String(message.chat.id),
      username: message.from?.username,
    });
    await event.channel.post(bindingReply(result));
  });

  bot.onDirectMessage(async (thread) => {
    await thread.post("发送 /start 可绑定候选人状态通知。");
  });

  cached = { adapter, bot };
  return bot;
}

export async function postTelegramDirectMessage(chatId: string, message: string): Promise<void> {
  const bot = getTelegramBot();
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
