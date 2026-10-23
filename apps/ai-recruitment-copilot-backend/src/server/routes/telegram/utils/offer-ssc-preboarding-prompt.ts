import { z } from "zod";

const promptResponse = z.object({
  ok: z.literal(true),
  result: z.object({
    chat: z.object({ id: z.number().int().positive(), type: z.literal("private") }),
    message_id: z.number().int().positive(),
  }),
});

export async function postTelegramOfferPreboardingPrompt(
  thread: { id: string },
  text: string,
): Promise<string> {
  const chatId = /^telegram:([1-9]\d*)$/u.exec(thread.id)?.[1];
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const failure = "发送预入职日期提示失败，请稍后重新点击日期确认。";
  if (!chatId || !token) {
    throw new Error(failure);
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({
        chat_id: chatId,
        reply_markup: { force_reply: true, input_field_placeholder: "YYYY-MM-DD，例如 2026-11-01" },
        text,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
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
    // Provider errors may contain a Bot Token; expose only this fixed message.
    throw new Error(failure);
  }
}
