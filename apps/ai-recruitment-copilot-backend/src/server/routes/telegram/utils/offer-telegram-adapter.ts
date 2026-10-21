import { AsyncLocalStorage } from "node:async_hooks";
import { TelegramAdapter } from "@chat-adapter/telegram";
import type { TelegramAdapterConfig } from "@chat-adapter/telegram";
import type { AdapterPostableMessage } from "chat";
import { splitTelegramOfferCopyText } from "./offer-telegram-copy";

function offerCopyText(message: AdapterPostableMessage) {
  if (typeof message !== "object" || message === null) {
    return;
  }
  const card = "card" in message ? message.card : message;
  if (
    typeof card !== "object" ||
    card === null ||
    !("type" in card) ||
    card.type !== "card" ||
    !("telegramOfferCopyText" in card) ||
    typeof card.telegramOfferCopyText !== "string"
  ) {
    return;
  }
  return card.telegramOfferCopyText;
}

class OfferTelegramAdapter extends TelegramAdapter {
  private readonly offerCopyScope = new AsyncLocalStorage<string | undefined>();

  override postMessage(threadId: string, message: AdapterPostableMessage) {
    return this.offerCopyScope.run(offerCopyText(message), () =>
      super.postMessage(threadId, message),
    );
  }

  override editMessage(threadId: string, messageId: string, message: AdapterPostableMessage) {
    return this.offerCopyScope.run(offerCopyText(message), () =>
      super.editMessage(threadId, messageId, message),
    );
  }

  protected override telegramFetch<TResult>(
    method: string,
    payload?: Record<string, unknown> | FormData,
    request?: { signal?: AbortSignal },
  ): Promise<TResult> {
    const text = this.offerCopyScope.getStore();
    if (
      text === undefined ||
      !["sendMessage", "sendRichMessage", "editMessageText"].includes(method) ||
      !payload ||
      payload instanceof FormData
    ) {
      return super.telegramFetch<TResult>(method, payload, request);
    }
    const parts = splitTelegramOfferCopyText(text);
    if (parts.length === 0) {
      return super.telegramFetch<TResult>(method, payload, request);
    }
    const markup = payload.reply_markup;
    const existing = markup && typeof markup === "object" ? markup : {};
    const keyboard =
      "inline_keyboard" in existing && Array.isArray(existing.inline_keyboard)
        ? existing.inline_keyboard
        : [];
    const copyRows = parts.map((part, index) => [
      {
        copy_text: { text: part },
        text: parts.length === 1 ? "复制 Offer 信息" : `复制第 ${index + 1}/${parts.length} 段`,
      },
    ]);
    // Add native clipboard buttons before the SDK makes its single HTTP request.
    // Per-operation scope also covers Markdown fallback retries without affecting
    // concurrent notifications or unrelated bot messages.
    return super.telegramFetch<TResult>(
      method,
      { ...payload, reply_markup: { ...existing, inline_keyboard: [...keyboard, ...copyRows] } },
      request,
    );
  }
}

export function createOfferTelegramAdapter(config: TelegramAdapterConfig) {
  return new OfferTelegramAdapter(config);
}
