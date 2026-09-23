import { describe, expect, it } from "vitest";
import { bulkUploadSelectionModel } from "./bulk-upload-selection";

const job = {
  departmentId: "department",
  departmentName: null,
  hiringUnitId: "one",
  id: "jd-one",
  name: " 产品经理 ",
  serviceUnit: null,
};
const options = {
  departments: [],
  hiringUnits: [
    { id: "one", name: "组织" },
    { id: "one", name: "组织" },
    { id: "two", name: "组织" },
  ],
  jobDescriptions: [job, job, { ...job, hiringUnitId: "two", id: "jd-two", name: "产品经理" }],
};

describe("bulk upload identities", () => {
  it("deduplicates job names, organization IDs and concrete IDs independently", () => {
    const model = bulkUploadSelectionModel(options, {
      hiringUnitIds: ["one", "two", "one"],
      jobNames: ["产品经理"],
    });
    expect(model.jobOptions).toEqual([{ label: "产品经理", value: "产品经理" }]);
    expect(model.unitOptions).toEqual([
      { label: "组织", value: "one" },
      { label: "组织", value: "two" },
    ]);
    expect(model.destinations.map((row) => row.id)).toEqual(["jd-one", "jd-two"]);
  });
  it("excludes destinations removed from current accessible organizations", () => {
    const model = bulkUploadSelectionModel(
      { ...options, hiringUnits: [options.hiringUnits[0]] },
      {
        hiringUnitIds: ["one", "two"],
        jobNames: ["产品经理"],
      },
    );
    expect(model.destinations.map((row) => row.id)).toEqual(["jd-one"]);
    expect(model.unitOptions.map((row) => row.value)).toEqual(["one"]);
  });
});
