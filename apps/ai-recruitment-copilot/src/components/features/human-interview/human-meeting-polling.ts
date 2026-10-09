/** Remaining time comes from the server, measured until entry opens (start minus 10 minutes). */
export function getMeetingPollInterval(remainingMs: number | null | undefined): number {
  if (remainingMs === null || remainingMs === undefined || remainingMs <= 5 * 60_000) {
    return 30_000;
  }
  if (remainingMs <= 30 * 60_000) {
    return 2 * 60_000;
  }
  if (remainingMs <= 2 * 60 * 60_000) {
    return 5 * 60_000;
  }
  return 10 * 60_000;
}
