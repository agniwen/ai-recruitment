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
  it.each([{ jobNames: [] }, { jobNames: ["产品经理"] }])(
    "only offers organizations with available jobs when selected job names are $jobNames",
    ({ jobNames }) => {
      const choices = {
        ...options,
        hiringUnits: [...options.hiringUnits, { id: "empty", name: "组织" }],
      };
      const model = bulkUploadSelectionModel(choices, { hiringUnitIds: [], jobNames });
      expect(model.unitOptions.map((row) => row.value)).toEqual(["one", "two"]);
      for (const unit of model.unitOptions) {
        expect(
          bulkUploadSelectionModel(choices, { hiringUnitIds: [unit.value], jobNames: [] })
            .jobOptions.length,
        ).toBeGreaterThan(0);
      }
    },
  );
  it("keeps an already selected organization visible if its jobs become unavailable", () => {
    const model = bulkUploadSelectionModel(
      { ...options, jobDescriptions: [] },
      { hiringUnitIds: ["one"], jobNames: [] },
    );
    expect(model.unitOptions.map((row) => row.value)).toEqual(["one"]);
    expect(model.destinations).toEqual([]);
  });
  it("filters both option lists with OR while retaining selected unmatched values", () => {
    const choices = {
      departments: [],
      hiringUnits: ["one", "two", "three"].map((id) => ({ id, name: id })),
      jobDescriptions: ["one", "two", "three"].map((id, index) => ({
        ...job,
        hiringUnitId: id,
        id,
        name: ["A", "B", "C"][index],
      })),
    };
    const jobsFirst = bulkUploadSelectionModel(choices, {
      hiringUnitIds: ["one"],
      jobNames: ["A", "B"],
    });
    expect(jobsFirst.jobOptions.map((row) => row.value)).toEqual(["A", "B"]);
    expect(jobsFirst.unitOptions.map((row) => row.value)).toEqual(["one", "two"]);
    expect(jobsFirst.destinations.map((row) => row.id)).toEqual(["one"]);

    const unitsFirst = bulkUploadSelectionModel(choices, {
      hiringUnitIds: ["one", "two"],
      jobNames: ["A"],
    });
    expect(unitsFirst.jobOptions.map((row) => row.value)).toEqual(["A", "B"]);
    expect(unitsFirst.unitOptions.map((row) => row.value)).toEqual(["one", "two"]);
    expect(unitsFirst.destinations.map((row) => row.id)).toEqual(["one"]);

    const cleared = bulkUploadSelectionModel(choices, { hiringUnitIds: [], jobNames: [] });
    expect(cleared.jobOptions.map((row) => row.value)).toEqual(["A", "B", "C"]);
    expect(cleared.unitOptions.map((row) => row.value)).toEqual(["one", "two", "three"]);
  });
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
