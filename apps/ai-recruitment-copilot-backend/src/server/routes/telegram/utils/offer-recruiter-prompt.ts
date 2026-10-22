import { z } from "zod";

const promptResponse = z.object({
  ok: z.literal(true),
  result: z.object({
    chat: z.object({ id: z.number().int().positive(), type: z.literal("private") }),
    message_id: z.number().int().positive(),
  }),
});

export async function postTelegramOfferRecruiterPrompt(
  thread: { id: string },
  text: string,
): Promise<string> {
  const chatId = /^telegram:([1-9]\d*)$/u.exec(thread.id)?.[1];
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const failure = "发送候选人 TG 提示失败，请稍后重新点击补充。";
  if (!chatId || !token) {
    throw new Error(failure);
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({
        chat_id: chatId,
        reply_markup: {
          force_reply: true,
          input_field_placeholder: "候选人私人 TG，例如 @candidate_name",
        },
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
    // Provider transport errors may contain the bot token in the URL.
    throw new Error(failure);
  }
}
