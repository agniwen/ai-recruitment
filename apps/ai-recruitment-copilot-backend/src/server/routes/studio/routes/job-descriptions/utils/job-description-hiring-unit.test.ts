import { describe, expect, it } from "vitest";
import { resolveJobDescriptionHiringUnit } from "../dao";

describe("resolveJobDescriptionHiringUnit", () => {
  const departmentHiringUnit = {
    departmentHiringUnitId: "department-unit",
    departmentHiringUnitName: "部门编制组织",
  };

  it("keeps an explicitly empty hiring unit empty for Google-synced jobs", () => {
    expect(
      resolveJobDescriptionHiringUnit({
        ...departmentHiringUnit,
        creationSource: "google_sheets",
        hiringUnitId: null,
        hiringUnitName: null,
      }),
    ).toEqual({
      hiringUnitId: null,
      hiringUnitName: null,
    });
  });

  it("retains the department fallback for manually created jobs", () => {
    expect(
      resolveJobDescriptionHiringUnit({
        ...departmentHiringUnit,
        creationSource: "manual",
        hiringUnitId: null,
        hiringUnitName: null,
      }),
    ).toEqual({
      hiringUnitId: "department-unit",
      hiringUnitName: "部门编制组织",
    });
  });
});
