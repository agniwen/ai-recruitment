import { describe, expect, it } from "vitest";
import {
  emptyImportDestination,
  importJobNameOptions,
  matchingImportJobs,
  resolveImportDestination,
  resolveImportDestinations,
} from "./resume-pool-import-selection";

const options = {
  departments: [],
  hiringUnits: [],
  jobDescriptions: [
    { departmentId: "d1", hiringUnitId: "one", id: "a", name: "前端", serviceUnit: "平台" },
    { departmentId: "d2", hiringUnitId: "two", id: "b", name: "前端", serviceUnit: "应用" },
    { departmentId: "d3", hiringUnitId: "one", id: "c", name: "前端", serviceUnit: "应用" },
    { departmentId: "d1", hiringUnitId: "one", id: "d", name: "后端", serviceUnit: "平台" },
  ],
};

describe("import destination selection", () => {
  it("shows each job name once and intersects all selected organizations", () => {
    expect(
      importJobNameOptions(options, [])
        .map((row) => row.value)
        .toSorted(),
    ).toEqual(["前端", "后端"]);
    expect(
      importJobNameOptions(options, [emptyImportDestination("one"), emptyImportDestination("two")]),
    ).toEqual([{ label: "前端", value: "前端" }]);
  });
  it("never picks an arbitrary record for an ambiguous job name", () => {
    expect(
      resolveImportDestination(options, "前端", emptyImportDestination("one")).jobDescriptionId,
    ).toBeNull();
    expect(
      resolveImportDestination(options, "前端", {
        ...emptyImportDestination("one"),
        jobDescriptionId: "a",
      }).jobDescriptionId,
    ).toBe("a");
  });
  it("derives department and service from the JD without restricting other choices", () => {
    const row = { ...emptyImportDestination("one"), jobDescriptionId: "a", serviceUnit: "应用" };
    expect(matchingImportJobs(options, "前端", row).map((job) => job.id)).toEqual(["a", "c"]);
    expect(resolveImportDestination(options, "前端", row)).toMatchObject({
      departmentId: "d1",
      jobDescriptionId: "a",
      serviceUnit: "平台",
    });
    expect(
      importJobNameOptions(options, [
        resolveImportDestination(options, "前端", { ...row, jobDescriptionId: "c" }),
      ]),
    ).toContainEqual({ label: "后端", value: "后端" });
    expect(resolveImportDestination(options, "", row)).toMatchObject({
      departmentId: null,
      jobDescriptionId: null,
      serviceUnit: null,
    });
  });
  it("preserves multiple selected jobs with their own department and service", () => {
    const rows = resolveImportDestinations(options, "前端", [
      { ...emptyImportDestination("one"), jobDescriptionId: "a" },
      { ...emptyImportDestination("one"), jobDescriptionId: "c" },
      emptyImportDestination("two"),
    ]);
    expect(rows).toEqual([
      { departmentId: "d1", hiringUnitId: "one", jobDescriptionId: "a", serviceUnit: "平台" },
      { departmentId: "d3", hiringUnitId: "one", jobDescriptionId: "c", serviceUnit: "应用" },
      { departmentId: "d2", hiringUnitId: "two", jobDescriptionId: "b", serviceUnit: "应用" },
    ]);
    expect(importJobNameOptions(options, rows)).toEqual([{ label: "前端", value: "前端" }]);
  });
  it("removes stale selections without duplicating an automatic single match", () => {
    const rows = [
      { ...emptyImportDestination("one"), jobDescriptionId: "a" },
      { ...emptyImportDestination("one"), jobDescriptionId: "c" },
    ];
    expect(resolveImportDestinations(options, "后端", rows)).toEqual([
      { departmentId: "d1", hiringUnitId: "one", jobDescriptionId: "d", serviceUnit: "平台" },
    ]);
    expect(resolveImportDestinations(options, "", rows)).toEqual([emptyImportDestination("one")]);
    expect(resolveImportDestinations(options, "前端", [emptyImportDestination("one")])).toEqual([
      emptyImportDestination("one"),
    ]);
  });
});
