export const TELEGRAM_COPY_TEXT_LIMIT = 256;
export const TELEGRAM_OFFER_COPY_MAX_PARTS = 8;

export function splitTelegramOfferCopyText(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + TELEGRAM_COPY_TEXT_LIMIT, text.length);
    // A UTF-16 limit is conservative for Telegram's character limit; do not split
    // an astral character between its two code units at a segment boundary.
    const boundaryCodePoint = text.codePointAt(end - 1);
    if (boundaryCodePoint !== undefined && boundaryCodePoint > 65_535) {
      end -= 1;
    }
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline >= start) {
        end = newline + 1;
      }
    }
    parts.push(text.slice(start, end));
    // Do not present only the first part of an oversized Offer as a full copy.
    if (parts.length > TELEGRAM_OFFER_COPY_MAX_PARTS) {
      return [];
    }
    start = end;
  }
  return parts;
}
