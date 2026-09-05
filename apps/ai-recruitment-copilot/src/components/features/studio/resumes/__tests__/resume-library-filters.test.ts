import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../resume-library-page.tsx", import.meta.url), "utf-8");

describe("resume library filters", () => {
  it("places the fuzzy ID filter first", () => {
    const filtersStart = pageSource.indexOf("const filtersConfig = useMemo");
    const filtersSource = pageSource.slice(
      filtersStart,
      pageSource.indexOf("async function handleDelete", filtersStart),
    );
    expect(filtersSource.indexOf('key: "id"')).toBeLessThan(
      filtersSource.indexOf('key: "candidateName"'),
    );
  });

  it("renders all filters and the ODC activity date range without a collapse control", () => {
    expect(pageSource).toContain("filters={filtersConfig}");
    expect(pageSource).not.toContain("useResumeLibraryCollapsibleFiltersWithState");
    expect(pageSource).toContain("activityFrom");
    expect(pageSource).toContain("activityTo");
    expect(pageSource).not.toContain("filtersExtra={");
  });
});
