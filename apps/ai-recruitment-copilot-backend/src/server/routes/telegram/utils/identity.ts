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
