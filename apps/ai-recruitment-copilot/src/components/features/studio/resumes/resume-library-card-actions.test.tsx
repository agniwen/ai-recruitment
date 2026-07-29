// @vitest-environment jsdom

import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeLibraryCardActions } from "./resume-library-card-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];

afterEach(() => {
  for (const { host, root } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

describe("ResumeLibraryCardActions", () => {
  it("hides the AI interview action for candidates bound to an AI-disabled job", () => {
    const record = {
      hasInterviewRounds: false,
      hasResumeFile: false,
      jobDescriptionAiInterviewDisabled: true,
      pipelineStage: "screening",
      resumeFileName: null,
      resumeParseStatus: "ready",
    } as ResumeLibraryListRecord;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push({ host, root });

    act(() => {
      root.render(
        <ResumeLibraryCardActions
          canCopyLink={false}
          canCreateInterview
          canDeleteResumeLibrary={false}
          canUpdateResumeLibrary={false}
          onCopyDetailLink={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onLaunchInterview={vi.fn()}
          onPreviewResume={vi.fn()}
          onTransition={vi.fn()}
          record={record}
        />,
      );
    });

    expect(host.textContent).not.toContain("AI面");
  });

  it.each([
    ["has no bound job", { jobDescriptionId: null, resumeEvaluationStatus: "pass" }],
    [
      "has not passed resume evaluation",
      { jobDescriptionId: "job-1", resumeEvaluationStatus: null },
    ],
    ["failed resume evaluation", { jobDescriptionId: "job-1", resumeEvaluationStatus: "fail" }],
    [
      "job has no AI interviewers",
      {
        jobDescriptionId: "job-1",
        jobDescriptionInterviewers: [],
        resumeEvaluationStatus: "pass",
      },
    ],
  ])("hides the AI interview action when the candidate %s", (_, gateFields) => {
    const record = {
      hasInterviewRounds: false,
      hasResumeFile: false,
      jobDescriptionAiInterviewDisabled: false,
      jobDescriptionInterviewers: [{ id: "iv-1", name: "面试官" }],
      pipelineStage: "screening",
      resumeFileName: null,
      resumeParseStatus: "ready",
      ...gateFields,
    } as ResumeLibraryListRecord;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push({ host, root });

    act(() => {
      root.render(
        <ResumeLibraryCardActions
          canCopyLink={false}
          canCreateInterview
          canDeleteResumeLibrary={false}
          canUpdateResumeLibrary={false}
          onCopyDetailLink={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onLaunchInterview={vi.fn()}
          onPreviewResume={vi.fn()}
          onTransition={vi.fn()}
          record={record}
        />,
      );
    });

    expect(host.textContent).not.toContain("AI面");
  });
});
