// @vitest-environment jsdom

import type { PipelineStage } from "@arc/db-schema/studio-interviews";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineStageActionBar } from "../pipeline-stage-action-bar";

const copyInterviewLinkMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/features/studio/interviews/interview-link-actions", () => ({
  copyInterviewLink: copyInterviewLinkMock,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];

function renderActionBar({
  aiRoundInterviewLink,
  aiInterviewDisabled,
  evaluationActions,
  hasJobDescription,
  onAdvance = vi.fn(),
  pipelineStage = "ai_interview",
  primaryAction,
  resumeEvaluationPassed,
}: {
  aiRoundInterviewLink?: string;
  aiInterviewDisabled?: boolean;
  evaluationActions?: ReactNode;
  hasJobDescription?: boolean;
  onAdvance?: (target: PipelineStage) => void | Promise<void>;
  pipelineStage?: PipelineStage;
  primaryAction?: ReactNode;
  resumeEvaluationPassed?: boolean;
} = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push({ host, root });

  act(() => {
    root.render(
      <PipelineStageActionBar
        aiRoundInterviewLink={aiRoundInterviewLink}
        aiInterviewDisabled={aiInterviewDisabled}
        evaluationActions={evaluationActions}
        hasJobDescription={hasJobDescription}
        onAdvance={onAdvance}
        onRequestClose={vi.fn()}
        onRequestReactivate={vi.fn()}
        onViewCurrentStage={vi.fn()}
        pipelineStage={pipelineStage}
        primaryAction={primaryAction}
        resumeEvaluationPassed={resumeEvaluationPassed}
      />,
    );
  });

  return host;
}

function getButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
}

afterEach(() => {
  for (const { host, root } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  vi.clearAllMocks();
});

describe("PipelineStageActionBar interactions", () => {
  it("copies the pending AI interview link from the stage action bar", () => {
    const host = renderActionBar({ aiRoundInterviewLink: "https://example.com/interview/1" });

    act(() => getButton(host, "复制面试链接").click());

    expect(copyInterviewLinkMock).toHaveBeenCalledWith({
      interviewLink: "https://example.com/interview/1",
    });
  });

  it("locks all stage actions and shows loading copy while an advance is pending", async () => {
    const advance = Promise.withResolvers<null>();
    const onAdvance = vi.fn(async () => {
      await advance.promise;
    });
    const host = renderActionBar({
      aiRoundInterviewLink: "https://example.com/interview/1",
      onAdvance,
    });

    act(() => getButton(host, "安排真人面试").click());

    await vi.waitFor(() => {
      expect(onAdvance).toHaveBeenCalledWith("human_interview");
      expect(getButton(host, "处理中...").disabled).toBe(true);
      expect(getButton(host, "复制面试链接").disabled).toBe(true);
      expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
      expect(host.querySelector('[aria-label^="当前招聘阶段："]')?.getAttribute("aria-busy")).toBe(
        "true",
      );
    });

    act(() => getButton(host, "处理中...").click());
    expect(onAdvance).toHaveBeenCalledTimes(1);

    await act(async () => {
      advance.resolve(null);
      await advance.promise;
    });

    expect(getButton(host, "安排真人面试").disabled).toBe(false);
    expect(host.querySelector('[aria-label^="当前招聘阶段："]')?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("hides the written-test advance action when the job disables AI interviews", () => {
    const host = renderActionBar({
      aiInterviewDisabled: true,
      pipelineStage: "written_test",
    });

    expect(host.textContent).not.toContain("推进到 AI 面试");
  });

  it("hides a supplied launch action when the job disables AI interviews", () => {
    const host = renderActionBar({
      aiInterviewDisabled: true,
      pipelineStage: "screening",
      primaryAction: <button type="button">发起 AI 面试</button>,
    });

    expect(host.textContent).not.toContain("发起 AI 面试");
  });

  it("hides evaluation and next-interview actions when no job is bound", () => {
    const host = renderActionBar({
      evaluationActions: <button type="button">评估通过</button>,
      hasJobDescription: false,
      pipelineStage: "screening",
      primaryAction: <button type="button">发起 AI 面试</button>,
    });

    expect(host.textContent).not.toContain("评估通过");
    expect(host.textContent).not.toContain("发起 AI 面试");
    expect(host.textContent).not.toContain("安排真人面试");
  });

  it("hides all screening next-interview actions before the resume passes evaluation", () => {
    const host = renderActionBar({
      pipelineStage: "screening",
      primaryAction: <button type="button">发起 AI 面试</button>,
      resumeEvaluationPassed: false,
    });

    expect(host.textContent).not.toContain("发起 AI 面试");
    expect(host.textContent).not.toContain("安排真人面试");
  });

  it("hides the human-interview advance after a legacy AI round without a passed evaluation", () => {
    const host = renderActionBar({
      pipelineStage: "ai_interview",
      resumeEvaluationPassed: false,
    });

    expect(host.textContent).not.toContain("安排真人面试");
  });

  it("keeps resume evaluation actions beside the current stage when AI interviews are disabled", () => {
    const host = renderActionBar({
      aiInterviewDisabled: true,
      evaluationActions: (
        <>
          <button className="text-green-700" type="button">
            评估通过
          </button>
          <button className="text-red-700" type="button">
            评估不通过
          </button>
        </>
      ),
      pipelineStage: "screening",
      primaryAction: <button type="button">发起 AI 面试</button>,
    });

    const stageControl = host.querySelector('[aria-label^="查看当前阶段："]');
    const passButton = getButton(host, "评估通过");
    const failButton = getButton(host, "评估不通过");

    expect(stageControl?.compareDocumentPosition(passButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(passButton.compareDocumentPosition(failButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(host.textContent).not.toContain("发起 AI 面试");
  });

  it("keeps evaluation available for an unassessed record in a legacy closed stage", () => {
    const host = renderActionBar({
      evaluationActions: <button type="button">评估通过</button>,
      pipelineStage: "closed",
    });

    expect(getButton(host, "评估通过")).toBeDefined();
  });

  it("groups the two evaluation decisions separately from other primary actions", () => {
    const host = renderActionBar({
      evaluationActions: (
        <>
          <button type="button">评估通过</button>
          <button type="button">评估不通过</button>
        </>
      ),
      pipelineStage: "screening",
      primaryAction: <button type="button">发起 AI 面试</button>,
    });

    const evaluationGroup = getButton(host, "评估通过").closest('[role="group"]');
    const launchGroup = getButton(host, "发起 AI 面试").closest('[role="group"]');

    expect(getButton(host, "评估不通过").closest('[role="group"]')).toBe(evaluationGroup);
    expect(evaluationGroup).not.toBe(launchGroup);
  });
});
