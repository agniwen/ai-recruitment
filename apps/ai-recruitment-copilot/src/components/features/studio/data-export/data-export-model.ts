export const DATA_EXPORT_LIMIT = 1000;
export const DATA_EXPORT_PAGE_SIZE = 10;

export type DataExportSource = "candidates" | "resumePool";
export type DataExportRange = "all" | "current";

export interface DataExportColumn<T> {
  id: string;
  label: string;
  value: (row: T) => boolean | number | string | null | undefined;
  width?: number;
}

export function normalizeExportColumnIds(
  storedIds: readonly string[] | null | undefined,
  supportedIds: readonly string[],
  defaultIds: readonly string[],
): string[] {
  const storedSet = new Set(storedIds);
  const normalized = supportedIds.filter((id) => storedSet.has(id));
  return normalized.length > 0 ? normalized : [...defaultIds];
}

export function takeExportRows<T>(rows: readonly T[]) {
  return {
    rows: rows.slice(0, DATA_EXPORT_LIMIT),
    truncated: rows.length > DATA_EXPORT_LIMIT,
  };
}

export function exportColumnStorageKey(source: DataExportSource): string {
  return `studio-data-export-columns:${source}:v1`;
}

export function readStoredExportColumnIds(source: DataExportSource): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = JSON.parse(window.localStorage.getItem(exportColumnStorageKey(source)) ?? "null");
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredExportColumnIds(source: DataExportSource, ids: readonly string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(exportColumnStorageKey(source), JSON.stringify(ids));
}
