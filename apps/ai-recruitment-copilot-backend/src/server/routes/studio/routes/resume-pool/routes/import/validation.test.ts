import { describe, expect, it } from "vitest";
import { resumePoolBatchImportSchema } from "@arc/shared/resume-pool";
import type { ResumePoolImportOptions } from "@arc/shared/resume-pool";
import { validateImportDestinations } from "./validation";

const options = {
  departments: [
    { hiringUnitId: "one", id: "d1", name: "部门一" },
    { hiringUnitId: "two", id: "d2", name: "部门二" },
  ],
  hiringUnits: [
    { id: "one", name: "一" },
    { id: "two", name: "二" },
  ],
  jobDescriptions: [
    {
      departmentId: "d1",
      departmentName: "部门一",
      hiringUnitId: "one",
      id: "a",
      name: "前端",
      serviceUnit: "平台",
    },
    {
      departmentId: "d2",
      departmentName: "部门二",
      hiringUnitId: "two",
      id: "b",
      name: "前端",
      serviceUnit: "应用",
    },
  ],
} as ResumePoolImportOptions;
const base = {
  destinations: [
    { hiringUnitId: "one", jobDescriptionId: "a" },
    { hiringUnitId: "two", jobDescriptionId: "b" },
  ],
  jobDescriptionMode: "bind",
  requestId: "d2a028a8-6161-42e8-9310-c700c1772fbc",
};

describe("batch import destinations", () => {
  it("resolves each organization's actual department and service from its job", () => {
    expect(validateImportDestinations(resumePoolBatchImportSchema.parse(base), options)).toEqual([
      {
        departmentId: "d1",
        departmentName: "部门一",
        hiringUnitId: "one",
        jobDescriptionId: "a",
        serviceUnit: "平台",
      },
      {
        departmentId: "d2",
        departmentName: "部门二",
        hiringUnitId: "two",
        jobDescriptionId: "b",
        serviceUnit: "应用",
      },
    ]);
  });
  it.each([
    { hiringUnitId: "other", jobDescriptionId: "a" },
    { hiringUnitId: "two", jobDescriptionId: "a" },
    { departmentId: "d2", hiringUnitId: "one", jobDescriptionId: "a" },
    { hiringUnitId: "one", jobDescriptionId: "a", serviceUnit: "应用" },
  ])("rejects forged or stale destination %j", (destination) => {
    expect(() =>
      validateImportDestinations(
        resumePoolBatchImportSchema.parse({ ...base, destinations: [destination] }),
        options,
      ),
    ).toThrow();
  });
  it("rejects duplicate organizations and unbound cross-organization departments", () => {
    expect(
      resumePoolBatchImportSchema.safeParse({
        ...base,
        destinations: [base.destinations[0], base.destinations[0]],
      }).success,
    ).toBe(false);
    expect(() =>
      validateImportDestinations(
        resumePoolBatchImportSchema.parse({
          ...base,
          destinations: [{ departmentId: "d2", hiringUnitId: "one" }],
          jobDescriptionMode: "none",
        }),
        options,
      ),
    ).toThrow("部门");
  });
});
