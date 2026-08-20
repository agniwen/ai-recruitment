// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransitionCandidateDialog } from "./transition-candidate-dialog";

const apiMocks = vi.hoisted(() => ({
  transitionInterviewRecord: vi.fn().mockImplementation(async () => {}),
}));

vi.mock("@/lib/client/api", () => ({
  fetchStudioResume: vi.fn(),
  transitionInterviewRecord: apiMocks.transitionInterviewRecord,
}));

vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceSlug: () => "workspace-1",
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TransitionCandidateDialog close", () => {
  it("submits optional TG and alias fields when marking a candidate as hired", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TransitionCandidateDialog
            candidate={{ candidateName: "候选人", id: "resume-1" }}
            mode="close"
            onCompleted={vi.fn()}
            onOpenChange={vi.fn()}
            open={true}
          />
        </QueryClientProvider>,
      );
    });

    act(() => {
      document.querySelector<HTMLInputElement>("#outcome-hired")?.click();
    });
    act(() => {
      const telegram = document.querySelector<HTMLInputElement>("#hired-telegram");
      const alias = document.querySelector<HTMLInputElement>("#hired-alias");
      if (telegram) {
        setInputValue(telegram, "@candidate");
      }
      if (alias) {
        setInputValue(alias, "小王");
      }
    });

    const confirmButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("确认结案"),
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(apiMocks.transitionInterviewRecord).toHaveBeenCalledWith("workspace-1", "resume-1", {
      closedMeta: {
        feedbackToCandidate: null,
        hiredDetails: {
          alias: "小王",
          joiningDate: null,
          joiningDepartment: null,
          joiningPosition: null,
          telegram: "@candidate",
        },
        internalNotes: null,
      },
      outcome: "hired",
      pipelineStage: "closed",
    });

    act(() => root.unmount());
  });
});

describe("TransitionCandidateDialog reactivation", () => {
  it("submits resume screening as the fixed reactivation stage", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TransitionCandidateDialog
            candidate={{ candidateName: "候选人", id: "resume-1" }}
            mode="reactivate"
            onCompleted={vi.fn()}
            onOpenChange={vi.fn()}
            open={true}
          />
        </QueryClientProvider>,
      );
    });

    expect(document.body.textContent).toContain("简历初筛");
    const stageTrigger = document.querySelector<HTMLButtonElement>("#reactivation-target-stage");
    await act(async () => {
      stageTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const stageOptions = [...document.querySelectorAll('[role="option"]')];
    expect(stageOptions).toHaveLength(1);
    expect(stageOptions[0]?.textContent).toBe("简历初筛");

    const reasonInput = document.querySelector<HTMLTextAreaElement>("#reactivation-reason");
    act(() => {
      if (reasonInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(reasonInput, "重新推进招聘");
        reasonInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const confirmButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("确认重新激活"),
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(apiMocks.transitionInterviewRecord).toHaveBeenCalledWith("workspace-1", "resume-1", {
      outcome: "in_pipeline",
      pipelineStage: "screening",
      reactivationReason: "重新推进招聘",
    });

    act(() => root.unmount());
  });
});
