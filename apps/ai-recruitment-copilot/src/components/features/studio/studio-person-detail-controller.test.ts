import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("studio-person-detail-controller.tsx", import.meta.url),
  "utf-8",
);

describe("StudioPersonDetailController resume record mapping", () => {
  it("passes the linked job AI interview setting to the floating action bar record", () => {
    const mappingStart = source.indexOf('} else if (mode === "resume" && resumeRecord) {');
    const mappingEnd = source.indexOf("const resumeInterviewResultRecord", mappingStart);
    const resumeRecordMapping = source.slice(mappingStart, mappingEnd);

    expect(resumeRecordMapping).toContain(
      "jobDescriptionAiInterviewDisabled: resumeRecord.jobDescriptionAiInterviewDisabled",
    );
  });
});
