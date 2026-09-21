import { describe, expect, it } from "vitest";
import { buildJobDescriptionQuery } from "./job-description-list-query";

const filters = {
  code: "REQ-001",
  dateField: "expectedOnboardDate",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-30",
  departmentId: "department-a,department-b",
  googleSheetStatus: "active",
  hiringUnitId: "unit-a",
  interviewerId: "interviewer-a",
  recruitmentStatus: "招聘中",
  sourceSheet: "招聘表",
  textFilters: "encoded-filter",
};

describe("buildJobDescriptionQuery", () => {
  it("keeps every active filter while omitting pagination for exports", () => {
    expect(
      buildJobDescriptionQuery({
        filters,
        search: "工程师",
        sortBy: "name",
        sortOrder: "asc",
      }),
    ).toEqual({
      code: "REQ-001",
      dateField: "expectedOnboardDate",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      departmentId: "department-a,department-b",
      googleSheetStatus: "active",
      hiringUnitId: "unit-a",
      interviewerId: "interviewer-a",
      recruitmentStatus: "招聘中",
      search: "工程师",
      sortBy: "name",
      sortOrder: "asc",
      sourceSheet: "招聘表",
      textFilters: "encoded-filter",
    });
  });

  it("adds pagination only for the on-screen list request", () => {
    expect(
      buildJobDescriptionQuery(
        { filters, search: "", sortBy: undefined, sortOrder: undefined },
        { page: 3, pageSize: 20 },
      ),
    ).toMatchObject({ page: "3", pageSize: "20", sortBy: "createdAt", sortOrder: "desc" });
  });
});
