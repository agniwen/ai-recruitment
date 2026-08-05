import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getVisibleResumeLibraryFilters,
  hasAdvancedResumeFiltersActive,
} from "../resume-library-filters";
import { EMPTY_FILTERS } from "../resume-library-page-model";
import type { ToolbarFilterConfig } from "@/components/data-grid";

const pageSource = readFileSync(new URL("../resume-library-page.tsx", import.meta.url), "utf-8");

const allFilters = [
  { key: "id", type: "search" },
  { key: "candidateName", type: "search" },
  { key: "candidateEmail", type: "search" },
  { key: "creatorIds", options: [], type: "multi-select" },
  { key: "candidatePhone", type: "search" },
  { key: "hiringUnitId", options: [], type: "select" },
  { key: "jdIds", options: [], type: "select" },
  { key: "skills", options: [], type: "multi-select" },
] as ToolbarFilterConfig[];

describe("resume library collapsible filters", () => {
  it("places the fuzzy ID filter first", () => {
    const filtersStart = pageSource.indexOf("const filtersConfig = useMemo");
    const filtersSource = pageSource.slice(
      filtersStart,
      pageSource.indexOf("useResumeLibraryCollapsibleFiltersWithState", filtersStart),
    );
    expect(filtersSource.indexOf('key: "id"')).toBeLessThan(
      filtersSource.indexOf('key: "candidateName"'),
    );
  });

  it("shows only primary filters when collapsed", () => {
    expect(getVisibleResumeLibraryFilters(allFilters, false).map((f) => f.key)).toEqual([
      "id",
      "candidateName",
      "candidateEmail",
      "creatorIds",
    ]);
  });

  it("shows every filter when expanded", () => {
    expect(getVisibleResumeLibraryFilters(allFilters, true)).toEqual(allFilters);
  });

  it("detects active advanced filters while ignoring stage and primary fields", () => {
    expect(hasAdvancedResumeFiltersActive(EMPTY_FILTERS)).toBe(false);
    expect(
      hasAdvancedResumeFiltersActive({
        ...EMPTY_FILTERS,
        candidateName: "张三",
        creatorIds: "u1",
        id: "a_1",
      }),
    ).toBe(false);
    expect(
      hasAdvancedResumeFiltersActive({
        ...EMPTY_FILTERS,
        skills: "React",
      }),
    ).toBe(true);
    expect(
      hasAdvancedResumeFiltersActive({
        ...EMPTY_FILTERS,
        stage: "screening",
      }),
    ).toBe(false);
  });
});
