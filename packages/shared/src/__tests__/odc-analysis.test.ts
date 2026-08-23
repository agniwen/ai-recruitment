import { describe, expect, it } from "vitest";
import {
  coerceOdcAnalysisSearch,
  filtersFromOdcAnalysisSearch,
  odcAnalysisFiltersSchema,
} from "../odc-analysis";

describe("ODC analysis filters", () => {
  it("normalizes the three independent dashboard filter groups", () => {
    expect(
      odcAnalysisFiltersSchema.parse({
        activityDate: "2026-08-23",
        activityJobDescriptionIds: ["jd-c", "jd-c"],
        demandDateField: "expectedOnboardDate",
        demandFrom: "2026-09-01",
        demandTo: "2026-09-30",
        progressFrom: "2026-08-01",
        progressJobDescriptionIds: ["jd-b", "jd-a", "jd-b"],
        progressTo: "2026-08-31",
      }),
    ).toEqual({
      activityDate: "2026-08-23",
      activityJobDescriptionIds: ["jd-c"],
      demandDateField: "expectedOnboardDate",
      demandFrom: "2026-09-01",
      demandTo: "2026-09-30",
      progressFrom: "2026-08-01",
      progressJobDescriptionIds: ["jd-a", "jd-b"],
      progressTo: "2026-08-31",
    });
  });

  it("rejects invalid and reversed date ranges", () => {
    expect(
      odcAnalysisFiltersSchema.safeParse({
        progressFrom: "2026-08-31",
        progressTo: "2026-08-01",
      }).success,
    ).toBe(false);
    expect(
      odcAnalysisFiltersSchema.safeParse({
        activityDate: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      odcAnalysisFiltersSchema.safeParse({
        demandFrom: "2025-01-01",
        demandTo: "2026-02-01",
      }).success,
    ).toBe(false);
  });

  it("coerces invalid URL state to the default filters", () => {
    expect(coerceOdcAnalysisSearch({ progressFrom: "not-a-date", progressJdIds: "jd-1" })).toEqual(
      {},
    );
  });

  it("round-trips URL search params into server filters", () => {
    const search = coerceOdcAnalysisSearch({
      activityDate: "2026-08-23",
      activityJdIds: "jd-c,jd-c",
      demandDateField: "expectedOnboardDate",
      demandFrom: "2026-09-01",
      demandTo: "2026-09-30",
      progressFrom: "2026-08-01",
      progressJdIds: "jd-b,jd-a,jd-b",
      progressTo: "2026-08-31",
    });
    expect(search).toEqual({
      activityDate: "2026-08-23",
      activityJdIds: "jd-c",
      demandDateField: "expectedOnboardDate",
      demandFrom: "2026-09-01",
      demandTo: "2026-09-30",
      progressFrom: "2026-08-01",
      progressJdIds: "jd-a,jd-b",
      progressTo: "2026-08-31",
    });
    expect(filtersFromOdcAnalysisSearch(search)).toEqual({
      activityDate: "2026-08-23",
      activityJobDescriptionIds: ["jd-c"],
      demandDateField: "expectedOnboardDate",
      demandFrom: "2026-09-01",
      demandTo: "2026-09-30",
      progressFrom: "2026-08-01",
      progressJobDescriptionIds: ["jd-a", "jd-b"],
      progressTo: "2026-08-31",
    });
  });

  it("defaults the demand field to requested date", () => {
    expect(filtersFromOdcAnalysisSearch({})).toMatchObject({
      demandDateField: "requestedDate",
    });
  });
});
