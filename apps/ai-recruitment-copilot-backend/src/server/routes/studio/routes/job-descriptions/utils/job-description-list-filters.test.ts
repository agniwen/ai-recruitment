import { describe, expect, it } from "vitest";
import { parseJobDescriptionListFilters } from "./job-description-list-filters";

describe("parseJobDescriptionListFilters", () => {
  it("normalizes text and CSV filters", () => {
    expect(
      parseJobDescriptionListFilters({
        code: " REQ-001 ",
        departmentId: "department-1, department-2",
        googleSheetStatus: "active,deleted",
        hiringUnitId: "unit-1, unit-2",
        interviewerId: "interviewer-1",
        recruitmentStatus: "招聘中,暂停招聘",
        search: " 工程师 ",
        sourceSheet: " 业务岗位汇总 ",
      }),
    ).toEqual({
      code: "REQ-001",
      departmentIds: ["department-1", "department-2"],
      googleSheetStatuses: ["active", "deleted"],
      hiringUnitIds: ["unit-1", "unit-2"],
      interviewerIds: ["interviewer-1"],
      recruitmentStatuses: ["招聘中", "暂停招聘"],
      search: "工程师",
      sourceSheet: "业务岗位汇总",
    });
  });

  it("drops unsupported enum values", () => {
    expect(
      parseJobDescriptionListFilters({
        googleSheetStatus: "active,unknown",
      }),
    ).toEqual({
      code: undefined,
      departmentIds: undefined,
      googleSheetStatuses: ["active"],
      hiringUnitIds: undefined,
      interviewerIds: undefined,
      recruitmentStatuses: undefined,
      search: undefined,
      sourceSheet: undefined,
    });
  });
});
