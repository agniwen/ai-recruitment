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

  it("routes the unbound-job action into the linked-job quick editor", () => {
    const actionStart = source.indexOf("const missingJobAction =");
    const actionEnd = source.indexOf("const actionBar =", actionStart);
    const actionSource = source.slice(actionStart, actionEnd);

    expect(actionSource).toContain('variant="ghost"');
    expect(actionSource).toContain("简历尚未绑定岗位");
    expect(actionSource).toContain('setActiveTab("overview")');
    expect(actionSource).toContain("setJobBindingRequestKey((current) => current + 1)");
  });
});
