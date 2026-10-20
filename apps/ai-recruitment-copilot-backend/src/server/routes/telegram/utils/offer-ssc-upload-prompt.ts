import { z } from "zod";

const promptResponse = z.object({
  ok: z.literal(true),
  result: z.object({
    chat: z.object({ id: z.number().int().positive(), type: z.literal("private") }),
    message_id: z.number().int().positive(),
  }),
});

// The adapter's plain-text post does not open Telegram's reply composer.
// ForceReply keeps the uploaded file tied to the exact approval prompt.
export async function postTelegramOfferScreenshotPrompt(
  thread: { id: string },
  text: string,
): Promise<string> {
  const chatId = /^telegram:([1-9]\d*)$/u.exec(thread.id)?.[1];
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const failure = "发送审批截图提示失败，请稍后重试。";
  if (!chatId || !token) {
    throw new Error(failure);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({
        chat_id: chatId,
        reply_markup: {
          force_reply: true,
          input_field_placeholder: "发送审批截图（选填）",
        },
        text,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(failure);
    }
    const prompt = promptResponse.parse(await response.json());
    if (String(prompt.result.chat.id) !== chatId) {
      throw new Error(failure);
    }
    return `${chatId}:${prompt.result.message_id}`;
  } catch {
    // Transport errors can include the Bot Token in their URL.
    throw new Error(failure);
  } finally {
    clearTimeout(timeout);
  }
}
