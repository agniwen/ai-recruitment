export function resolveSscMemberTelegram(
  entries: readonly { email: string; workspaceRole: string | null; telegram: string }[],
  input: { email: string; workspaceRole: string },
): string | null {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return null;
  }
  let username: string | null = null;
  for (const entry of entries) {
    if (entry.email.trim().toLowerCase() !== email || entry.workspaceRole !== input.workspaceRole) {
      continue;
    }
    const value = entry.telegram.trim();
    if (!value) {
      continue;
    }
    const handle = value.replace(/^@/u, "");
    if (!/^[a-zA-Z0-9_]{5,32}$/u.test(handle) || /^\d+$/u.test(handle)) {
      return null;
    }
    const candidate = handle.toLowerCase();
    if (username && username !== candidate) {
      return null;
    }
    username = candidate;
  }
  return username ? `@${username}` : null;
}
