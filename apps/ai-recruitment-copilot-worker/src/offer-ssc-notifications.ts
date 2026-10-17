export async function startOfferSscNotifications() {
  const { isTelegramBotConfigured } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot");
  if (!isTelegramBotConfigured()) {
    console.info("[offer-ssc-notifications] Telegram is not configured; outbox remains pending");
    return () => Promise.resolve();
  }
  const { dispatchOfferSscNotifications, listenForOfferSscNotifications } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-notification-outbox");
  let closed = false;
  let requested = false;
  let pending: Promise<void> | null = null;
  const wake = () => {
    if (closed) {
      return;
    }
    requested = true;
    if (pending) {
      return;
    }
    pending = (async () => {
      try {
        while (requested) {
          if (closed) {
            break;
          }
          requested = false;
          if ((await dispatchOfferSscNotifications()) > 0) {
            requested = true;
          }
        }
      } catch {
        console.error("[offer-ssc-notifications] outbox unavailable; will retry");
      } finally {
        pending = null;
      }
    })();
  };
  const timer = setInterval(wake, 30_000);
  timer.unref();
  let listener: { unlisten: () => Promise<void> } | undefined;
  try {
    listener = await listenForOfferSscNotifications(wake);
  } catch {
    console.error(
      "[offer-ssc-notifications] database notifications unavailable; using recovery poll",
    );
  }
  wake();
  return async () => {
    closed = true;
    clearInterval(timer);
    await listener?.unlisten();
    await pending;
  };
}
