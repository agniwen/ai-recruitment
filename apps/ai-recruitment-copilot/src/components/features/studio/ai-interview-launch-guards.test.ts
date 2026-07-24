import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf-8");
}

const actionBarSource = readSource("./pipeline-stage-action-bar.tsx");
const detailControllerSource = readSource("./studio-person-detail-controller.tsx");
const detailPageSource = readSource("../../../routes/w.$slug.studio.resumes.$recordId.tsx");
const jobDescriptionsPageSource = readSource("../../../routes/w.$slug.studio.job-descriptions.tsx");
const launchDialogSource = readSource("./resumes/launch-interview-dialog.tsx");
const resumeCardActionsSource = readSource("./resumes/resume-library-card-actions.tsx");
const resumeLibraryPageSource = readSource("./resumes/resume-library-page.tsx");

describe("AI interview launch guards", () => {
  it("hides launch actions in resume cards and candidate detail", () => {
    expect(resumeCardActionsSource).toContain("!record.jobDescriptionAiInterviewDisabled");
    expect(detailControllerSource).toContain(
      "jobDescriptionAiInterviewDisabled: resumeRecord.jobDescriptionAiInterviewDisabled",
    );
    expect(detailControllerSource).toContain("!record?.jobDescriptionAiInterviewDisabled");
    expect(actionBarSource).toContain(
      'pipelineStage === "closed" || aiInterviewDisabled ? null : primaryAction',
    );
  });

  it("blocks stale launch callbacks before opening the launch dialog", () => {
    expect(resumeLibraryPageSource).toContain("if (record.jobDescriptionAiInterviewDisabled)");
    expect(detailPageSource).toContain("if (detail?.jobDescriptionAiInterviewDisabled)");
  });

  it("rechecks the latest resume detail before showing or submitting the launch dialog", () => {
    expect(launchDialogSource).toContain("if (detail?.jobDescriptionAiInterviewDisabled)");
    expect(launchDialogSource).toContain(
      "resumeDetail && !resumeDetail.jobDescriptionAiInterviewDisabled ?",
    );
    expect(launchDialogSource).toContain("if (!resumeDetail)");
    expect(launchDialogSource).toContain("if (resumeDetail.jobDescriptionAiInterviewDisabled)");
  });

  it("invalidates candidate launch surfaces after a job setting changes", () => {
    expect(jobDescriptionsPageSource).toContain(
      'invalidateQueries({ queryKey: ["studio-resumes", slug] })',
    );
    expect(jobDescriptionsPageSource).toContain(
      'invalidateQueries({ queryKey: ["studio-interviews", slug] })',
    );
  });
});
