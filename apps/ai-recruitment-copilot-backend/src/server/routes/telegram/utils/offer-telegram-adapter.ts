import { AsyncLocalStorage } from "node:async_hooks";
import { TelegramAdapter, TelegramFormatConverter } from "@chat-adapter/telegram";
import type { TelegramAdapterConfig } from "@chat-adapter/telegram";
import type { AdapterPostableMessage } from "chat";
import { codeBlock, convertEmojiPlaceholders, root, stringifyMarkdown } from "chat";
import { splitTelegramOfferCopyText } from "./offer-telegram-copy";

const formatConverter = new TelegramFormatConverter();

function restoreOfferCopyBlock(payload: Record<string, unknown>, text: string) {
  if (
    typeof payload.text !== "string" ||
    (payload.parse_mode !== "MarkdownV2" && payload.parse_mode !== undefined)
  ) {
    return payload;
  }
  const block = root([codeBlock(text)]);
  const markdown = stringifyMarkdown(block).replace(/\n$/u, "");
  const source = payload.parse_mode === "MarkdownV2" ? formatConverter.fromAst(block) : markdown;
  const rendered =
    payload.parse_mode === "MarkdownV2" ? formatConverter.fromMarkdown(markdown) : markdown;
  // The SDK interpolates {{emoji:...}} even inside literal code blocks. Restore
  // only the complete Offer block actually present in this request, after that
  // interpolation. Exact matching also leaves long-text fallbacks untouched.
  const interpolated = convertEmojiPlaceholders(rendered, "gchat");
  return interpolated === source
    ? payload
    : { ...payload, text: payload.text.replace(interpolated, () => source) };
}

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
    const restoredPayload = restoreOfferCopyBlock(payload, text);
    const parts = splitTelegramOfferCopyText(text);
    if (parts.length !== 1) {
      return super.telegramFetch<TResult>(method, restoredPayload, request);
    }
    const markup = payload.reply_markup;
    const existing = markup && typeof markup === "object" ? markup : {};
    const keyboard =
      "inline_keyboard" in existing && Array.isArray(existing.inline_keyboard)
        ? existing.inline_keyboard
        : [];
    const copyRows = parts.map((part) => [
      {
        copy_text: { text: part },
        text: "复制 Offer 信息",
      },
    ]);
    // Add native clipboard buttons before the SDK makes its single HTTP request.
    // Per-operation scope also covers Markdown fallback retries without affecting
    // concurrent notifications or unrelated bot messages.
    return super.telegramFetch<TResult>(
      method,
      {
        ...restoredPayload,
        reply_markup: { ...existing, inline_keyboard: [...keyboard, ...copyRows] },
      },
      request,
    );
  }
}

export function createOfferTelegramAdapter(config: TelegramAdapterConfig) {
  return new OfferTelegramAdapter(config);
}
