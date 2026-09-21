import { describe, expect, it } from "vitest";
import {
  jobDescriptionDefaultExportColumnIds,
  jobDescriptionExportColumns,
} from "./job-description-export";

describe("job description export columns", () => {
  it("exports the complete visible recruiting dataset by default", () => {
    expect(jobDescriptionDefaultExportColumnIds).toEqual(
      jobDescriptionExportColumns.map((column) => column.id),
    );
    expect(jobDescriptionDefaultExportColumnIds).toEqual(
      expect.arrayContaining([
        "name",
        "code",
        "hiringUnitName",
        "departmentName",
        "recruitmentStatus",
        "headcount",
        "gapCount",
        "prompt",
        "interviewers",
        "resumeCount",
        "createdAt",
      ]),
    );
  });
});
