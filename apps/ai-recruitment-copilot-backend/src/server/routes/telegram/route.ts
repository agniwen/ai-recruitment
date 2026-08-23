import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

export const telegramRouter = factory.createApp().post("/telegram/webhook", async (c) => {
  const { getTelegramBot } = await import("./utils/bot");
  return getTelegramBot().webhooks.telegram(c.req.raw);
});
