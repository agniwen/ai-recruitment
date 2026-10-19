import type { ActionEvent, AdapterPostableMessage } from "chat";

// Message delivery must not turn a committed Offer transition into an approval error.
export async function updateTelegramOfferMessages(
  event: ActionEvent,
  card: AdapterPostableMessage,
  messageIds: string[] = [event.messageId],
): Promise<void> {
  let needsFallback = false;
  for (const messageId of new Set(messageIds)) {
    try {
      await event.adapter.editMessage(event.threadId, messageId, card);
    } catch {
      needsFallback = true;
    }
  }
  if (!needsFallback) {
    return;
  }
  try {
    await event.thread?.post(card);
  } catch {
    console.warn("[telegram-offer-ssc] Offer updated but status card delivery failed");
  }
}
