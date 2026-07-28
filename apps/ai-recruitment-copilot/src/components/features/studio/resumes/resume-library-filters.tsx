import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ToolbarFilterConfig } from "@/components/data-grid";
import { Button } from "@/components/ui/button";
import type { ResumeFilters } from "@/lib/start/studio/resumes.functions";
import { EMPTY_FILTERS, RESUME_LIBRARY_PRIMARY_FILTER_KEYS } from "./resume-library-page-model";

const PRIMARY_FILTER_KEY_SET = new Set<string>(RESUME_LIBRARY_PRIMARY_FILTER_KEYS);

export function hasAdvancedResumeFiltersActive(filters: ResumeFilters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof ResumeFilters)[]).some((key) => {
    if (key === "stage" || PRIMARY_FILTER_KEY_SET.has(String(key))) {
      return false;
    }
    return filters[key] !== EMPTY_FILTERS[key];
  });
}

export function getVisibleResumeLibraryFilters(
  filters: ToolbarFilterConfig[],
  expanded: boolean,
): ToolbarFilterConfig[] {
  if (expanded) {
    return filters;
  }
  return filters.filter((filter) => PRIMARY_FILTER_KEY_SET.has(filter.key));
}

export function ResumeLibraryFiltersExpandButton({
  expanded,
  hasAdvancedActive,
  onToggle,
}: {
  expanded: boolean;
  hasAdvancedActive: boolean;
  onToggle: () => void;
}) {
  const label = expanded ? "收起条件" : "更多条件";
  return (
    <Button
      aria-expanded={expanded}
      aria-label={label}
      // Match Toolbar refresh / reset: size="icon" → size-9 square, shrink-0.
      className="relative shrink-0"
      onClick={onToggle}
      size="icon"
      title={label}
      type="button"
      variant="outline"
    >
      {expanded ? <IconChevronUp className="size-4" /> : <IconChevronDown className="size-4" />}
      {!expanded && hasAdvancedActive ? (
        <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
      ) : null}
      <span className="sr-only">{label}</span>
    </Button>
  );
}

export function useResumeLibraryCollapsibleFiltersWithState(
  allFilters: ToolbarFilterConfig[],
  filterValues: ResumeFilters,
): {
  filtersExtra: ReactNode;
  visibleFilters: ToolbarFilterConfig[];
} {
  const [expanded, setExpanded] = useState(false);

  const visibleFilters = useMemo(
    () => getVisibleResumeLibraryFilters(allFilters, expanded),
    [allFilters, expanded],
  );

  const hasAdvancedActive = useMemo(
    () => hasAdvancedResumeFiltersActive(filterValues),
    [filterValues],
  );

  const filtersExtra = (
    <ResumeLibraryFiltersExpandButton
      expanded={expanded}
      hasAdvancedActive={hasAdvancedActive}
      onToggle={() => setExpanded((current) => !current)}
    />
  );

  return { filtersExtra, visibleFilters };
}
