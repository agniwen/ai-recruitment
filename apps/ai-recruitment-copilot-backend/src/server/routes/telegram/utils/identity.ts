const TELEGRAM_USERNAME_PATTERN = /^[a-zA-Z0-9_]{5,32}$/u;

export function extractRequesterTelegramUsernames(value: string | null | undefined): string[] {
  // Consume the entire handle before validation so overlong handles cannot match a prefix.
  const mentions = [...(value ?? "").matchAll(/@([a-zA-Z0-9_]+)/gu)];
  return [
    ...new Set(
      mentions
        .map((match) => match[1].toLowerCase())
        .filter((username) => TELEGRAM_USERNAME_PATTERN.test(username) && !/^\d+$/u.test(username)),
    ),
  ];
}

export function extractTelegramUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  const mentionMatches = [...normalized.matchAll(/@([a-zA-Z0-9_]{5,32})/gu)];
  const mentionedUsername = mentionMatches.at(-1)?.[1];
  const username = mentionedUsername ?? normalized;
  return TELEGRAM_USERNAME_PATTERN.test(username) ? username.toLowerCase() : null;
}

export function normalizeTelegramUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@/u, "").toLowerCase() ?? "";
  if (!normalized || /^\d+$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function resolveTelegramRecipientId(input: {
  boundUsername: string | null;
  chatId: string | null;
  profileTelegram: string | null;
}): string | null {
  const profileTelegram = input.profileTelegram?.trim() ?? "";
  if (/^\d+$/u.test(profileTelegram)) {
    return profileTelegram;
  }

  const profileUsername = normalizeTelegramUsername(profileTelegram);
  if (
    !profileUsername ||
    !input.chatId ||
    profileUsername !== normalizeTelegramUsername(input.boundUsername)
  ) {
    return null;
  }
  return input.chatId;
}
