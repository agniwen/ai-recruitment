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
  onAdvance = vi.fn(),
  pipelineStage = "ai_interview",
  primaryAction,
}: {
  aiRoundInterviewLink?: string;
  aiInterviewDisabled?: boolean;
  onAdvance?: (target: PipelineStage) => void | Promise<void>;
  pipelineStage?: PipelineStage;
  primaryAction?: ReactNode;
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
        onAdvance={onAdvance}
        onRequestClose={vi.fn()}
        onRequestReactivate={vi.fn()}
        onViewCurrentStage={vi.fn()}
        pipelineStage={pipelineStage}
        primaryAction={primaryAction}
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
});
