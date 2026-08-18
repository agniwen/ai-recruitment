import { describe, expect, it } from "vitest";
import {
  coerceOdcAnalysisSearch,
  filtersFromOdcAnalysisSearch,
  odcAnalysisFiltersSchema,
} from "../odc-analysis";

describe("ODC analysis filters", () => {
  it("normalizes and deduplicates selected jobs", () => {
    expect(
      odcAnalysisFiltersSchema.parse({
        from: "2026-08-01",
        jobDescriptionIds: ["jd-b", "jd-a", "jd-b"],
        to: "2026-08-31",
      }),
    ).toEqual({
      from: "2026-08-01",
      jobDescriptionIds: ["jd-a", "jd-b"],
      to: "2026-08-31",
    });
  });

  it("rejects invalid and reversed date ranges", () => {
    expect(
      odcAnalysisFiltersSchema.safeParse({
        from: "2026-08-31",
        jobDescriptionIds: [],
        to: "2026-08-01",
      }).success,
    ).toBe(false);
    expect(
      odcAnalysisFiltersSchema.safeParse({
        from: "2026-02-30",
        jobDescriptionIds: [],
      }).success,
    ).toBe(false);
    expect(
      odcAnalysisFiltersSchema.safeParse({
        from: "2025-01-01",
        jobDescriptionIds: [],
        to: "2026-02-01",
      }).success,
    ).toBe(false);
  });

  it("coerces invalid URL state to the default filters", () => {
    expect(coerceOdcAnalysisSearch({ from: "not-a-date", jdIds: "jd-1" })).toEqual({});
  });

  it("round-trips URL search params into server filters", () => {
    const search = coerceOdcAnalysisSearch({
      from: "2026-08-01",
      jdIds: "jd-b,jd-a,jd-b",
      to: "2026-08-31",
    });
    expect(search).toEqual({
      from: "2026-08-01",
      jdIds: "jd-a,jd-b",
      to: "2026-08-31",
    });
    expect(filtersFromOdcAnalysisSearch(search)).toEqual({
      from: "2026-08-01",
      jobDescriptionIds: ["jd-a", "jd-b"],
      to: "2026-08-31",
    });
  });
});
