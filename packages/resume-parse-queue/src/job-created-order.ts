/** BullMQ state order may reflect completion/priority, so sort before pagination. */
export function pageJobsByCreatedAt<T extends { id?: string; timestamp: number }>(
  jobs: readonly T[],
  start: number,
  pageSize: number,
): T[] {
  return jobs
    .toSorted((a, b) => b.timestamp - a.timestamp || (b.id ?? "").localeCompare(a.id ?? ""))
    .slice(start, start + pageSize);
}
