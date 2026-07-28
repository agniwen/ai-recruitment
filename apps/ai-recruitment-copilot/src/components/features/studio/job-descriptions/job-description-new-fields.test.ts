import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const formSource = readFileSync(
  new URL("job-description-form-dialog.tsx", import.meta.url),
  "utf-8",
);
const humanDialogSource = readFileSync(
  new URL("../human-interview-stage-dialogs.tsx", import.meta.url),
  "utf-8",
);
const humanPanelSource = readFileSync(
  new URL("../human-interview-stage-panel.tsx", import.meta.url),
  "utf-8",
);
const sidebarSource = readFileSync(
  new URL("../studio-sidebar-slots.tsx", import.meta.url),
  "utf-8",
);

describe("job description recruiting defaults", () => {
  it("renders priority, work schedule, AI interviewer, and human interviewer fields", () => {
    expect(formSource).toContain('<form.Field name="priority">');
    expect(formSource).toContain("P0（紧急/高）");
    expect(formSource).toContain("P1（中）");
    expect(formSource).toContain("P2（低）");
    expect(formSource).toContain('<form.Field name="workStartTime">');
    expect(formSource).toContain('<form.Field name="workEndTime">');
    expect(formSource).toContain('type="time"');
    expect(formSource).toContain('<form.Field name="workTimezone">');
    expect(formSource).toContain('<form.Field name="requester">');
    expect(formSource).toContain('<form.Field name="resumeContact">');
    expect(formSource).toContain("CONTACT_MAX_LENGTH = 500");
    expect(formSource).toContain("AI面试官");
    expect(formSource).toContain('<form.Field name="humanInterviewerIds">');
    expect(formSource).toContain("真人面试官（可选）");
  });

  it("defaults new human interview rounds from the linked job", () => {
    expect(humanPanelSource).toContain(
      "defaultInterviewerIds={resumeJobDescriptionHumanInterviewerIds}",
    );
    expect(humanDialogSource).toContain("defaultInterviewerIds?: string[];");
    expect(humanDialogSource).toContain("setInterviewerIds([...defaultInterviewerIds])");
  });

  it("renames the interviewer navigation entry", () => {
    expect(sidebarSource).toContain('title: "AI面试官设置"');
  });
});
