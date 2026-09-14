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
  it("allows copying a visible candidate without mutation permissions and hides disabled AI interviews", async () => {
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
    const onCopyDetailLink = vi.fn();

    act(() => {
      root.render(
        <ResumeLibraryCardActions
          canCloseCandidate={false}
          canCreateInterview={false}
          canDeleteResumeLibrary={false}
          canForceReparse={false}
          canRetryResumeParse={false}
          canUpdateResumeLibrary={false}
          onCopyDetailLink={onCopyDetailLink}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onForceReparse={vi.fn()}
          onLaunchInterview={vi.fn()}
          onPreviewResume={vi.fn()}
          onRetryParse={vi.fn()}
          onTransition={vi.fn()}
          record={record}
          retrying={false}
        />,
      );
    });

    expect(host.textContent).not.toContain("AI面");
    await act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click();
    });
    const copyItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "复制详情链接",
    );
    expect(copyItem).toBeDefined();
    await act(() => copyItem?.click());
    expect(onCopyDetailLink).toHaveBeenCalledWith(record);
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
          canCloseCandidate={false}
          canCreateInterview
          canDeleteResumeLibrary={false}
          canForceReparse={false}
          canRetryResumeParse={false}
          canUpdateResumeLibrary={false}
          onCopyDetailLink={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onForceReparse={vi.fn()}
          onLaunchInterview={vi.fn()}
          onPreviewResume={vi.fn()}
          onRetryParse={vi.fn()}
          onTransition={vi.fn()}
          record={record}
          retrying={false}
        />,
      );
    });

    expect(host.textContent).not.toContain("AI面");
  });
});
