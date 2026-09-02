/**
 * Clean env-provided API base URLs / model ids.
 * Console copy-paste often injects zero-width spaces that yield opaque 404s.
 */
// oxlint-disable-next-line no-control-regex -- env sanitization intentionally strips ASCII controls and invisible Unicode paste artifacts.
const INVISIBLE_URL_CHARS = /[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF]/gu;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/giu;

export function sanitizeApiUrl(raw: string | undefined | null, fallback = ""): string {
  if (!raw) {
    return fallback;
  }
  let value = raw.replace(INVISIBLE_URL_CHARS, "").trim();
  // Common paste typo from previous incidents.
  if (value.startsWith("hhttps://")) {
    value = `https://${value.slice("hhttps://".length)}`;
  }
  // OpenAI SDK joins paths; trailing slash is fine but normalize for logs/cache keys.
  return value.replace(/\/+$/u, "");
}

export function sanitizeModelId(raw: string | undefined | null, fallback = ""): string {
  if (!raw) {
    return fallback;
  }
  return raw.replace(INVISIBLE_URL_CHARS, "").trim() || fallback;
}

export function redactApiUrl(raw: string | undefined | null, fallback = ""): string {
  const value = sanitizeApiUrl(raw, fallback);
  if (!value) {
    return value;
  }
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return "(invalid URL)";
  }
}

export function redactUrlsInText(value: string): string {
  return value.replace(URL_IN_TEXT, (url) => redactApiUrl(url));
}
