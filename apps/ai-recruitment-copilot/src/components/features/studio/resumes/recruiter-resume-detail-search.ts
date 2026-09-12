import type { StudioPersonDetailTab } from "@/components/features/studio/studio-person-detail-panel";

type ResumeDetailPageSearchValue = boolean | number | string;
export type ResumeDetailPageSearch = Record<
  string,
  ResumeDetailPageSearchValue | ResumeDetailPageSearchValue[] | undefined
>;

const RESUME_DETAIL_TABS = new Set<StudioPersonDetailTab>([
  "overview",
  "rounds",
  "human-interview",
  "offer",
]);

function firstSearchValue(value: ResumeDetailPageSearch[string]) {
  return Array.isArray(value) ? value[0] : value;
}

export function coerceSearchParams(search: Record<string, unknown>): ResumeDetailPageSearch {
  const out: ResumeDetailPageSearch = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (item): item is ResumeDetailPageSearchValue =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
    }
  }
  return out;
}

export function resolveDefaultTab(search: ResumeDetailPageSearch): StudioPersonDetailTab {
  const tab = firstSearchValue(search.tab);
  return typeof tab === "string" && RESUME_DETAIL_TABS.has(tab as StudioPersonDetailTab)
    ? (tab as StudioPersonDetailTab)
    : "overview";
}

export function listSearchFromDetailSearch(search: ResumeDetailPageSearch): ResumeDetailPageSearch {
  const next = { ...search };
  delete next.tab;
  return next;
}
