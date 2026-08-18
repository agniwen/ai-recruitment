import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const daoSource = readFileSync(new URL("../dao.ts", import.meta.url), "utf-8");
const routeSource = readFileSync(new URL("../route.ts", import.meta.url), "utf-8");

describe("job description new field persistence", () => {
  it("persists priority and work schedule on create and update", () => {
    for (const field of ["priority", "workStartTime", "workEndTime", "workTimezone"]) {
      expect(routeSource).toContain(`input.${field}`);
      expect(daoSource).toContain(`${field}: jobDescription.${field}`);
    }
  });

  it("replaces optional human interviewer links atomically", () => {
    expect(routeSource).toContain("input.humanInterviewerIds");
    expect(routeSource).toContain("jobDescriptionHumanInterviewer");
    expect(daoSource).toContain("loadHumanInterviewerIdsForJobDescriptions");
  });

  it("accepts recommendation requests up to the shared 50-row cap", () => {
    expect(routeSource).toContain("JOB_DESCRIPTION_TALENT_RECOMMENDATION_MAX_LIMIT");
  });
});
