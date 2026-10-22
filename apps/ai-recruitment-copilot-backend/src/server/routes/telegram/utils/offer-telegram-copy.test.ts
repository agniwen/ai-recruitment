import { describe, expect, it } from "vitest";
import {
  splitTelegramOfferCopyText,
  TELEGRAM_COPY_TEXT_LIMIT,
  TELEGRAM_OFFER_COPY_MAX_PARTS,
} from "./offer-telegram-copy";

describe("Telegram Offer copy segments", () => {
  it.each(["", "\n", "  保留空格\n", "x".repeat(256)])(
    "keeps exact short text without trimming: %j",
    (text) => {
      expect(splitTelegramOfferCopyText(text)).toEqual(text ? [text] : []);
    },
  );

  it("prefers complete lines and preserves the newline between copy parts", () => {
    const first = `${"甲".repeat(200)}\n`;
    const second = `${"乙".repeat(200)}\n末行`;
    expect(splitTelegramOfferCopyText(first + second)).toEqual([first, second]);
  });

  it("never splits a surrogate pair at the 256-unit boundary", () => {
    const text = `${"x".repeat(255)}😀结尾`;
    const parts = splitTelegramOfferCopyText(text);
    expect(parts).toEqual(["x".repeat(255), "😀结尾"]);
    expect(parts.join("")).toBe(text);
  });

  it("preserves complete long and punctuation-rich contents exactly", () => {
    const text = `【offer信息】\n${"中文😀\\`*_[]()\n".repeat(70)}结尾\n`;
    const parts = splitTelegramOfferCopyText(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(text);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
      expect(part.length).toBeLessThanOrEqual(TELEGRAM_COPY_TEXT_LIMIT);
    }
  });

  it("keeps exactly eight full parts but never offers a partial ninth part", () => {
    const text = "甲".repeat(TELEGRAM_COPY_TEXT_LIMIT * TELEGRAM_OFFER_COPY_MAX_PARTS);
    const parts = splitTelegramOfferCopyText(text);
    expect(parts).toHaveLength(TELEGRAM_OFFER_COPY_MAX_PARTS);
    expect(parts.join("")).toBe(text);
    expect(splitTelegramOfferCopyText(`${text}乙`)).toEqual([]);
  });
});
