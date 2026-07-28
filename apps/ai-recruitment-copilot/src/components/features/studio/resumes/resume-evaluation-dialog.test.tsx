// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResumeEvaluationActions,
  ResumeEvaluationDialog,
  shouldShowResumeEvaluationActions,
} from "./resume-evaluation-dialog";

const apiMocks = vi.hoisted(() => ({
  submitResumeReviewEvaluation: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  submitResumeReviewEvaluation: apiMocks.submitResumeReviewEvaluation,
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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderDialog(decision: "pass" | "fail") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const onDecisionChange = vi.fn();
  const onSubmitted = vi.fn();

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ResumeEvaluationDialog
          decision={decision}
          onDecisionChange={onDecisionChange}
          onSubmitted={onSubmitted}
          recordId="resume-1"
        />
      </QueryClientProvider>,
    );
  });

  return { onDecisionChange, onSubmitted, queryClient, root };
}

describe("ResumeEvaluationDialog", () => {
  it("shows actions only on page details while the resume is unassessed", () => {
    expect(shouldShowResumeEvaluationActions({ layoutMode: "page", status: null })).toBe(true);
    expect(shouldShowResumeEvaluationActions({ layoutMode: "modal", status: null })).toBe(false);
    expect(shouldShowResumeEvaluationActions({ layoutMode: "page", status: undefined })).toBe(
      false,
    );
    expect(shouldShowResumeEvaluationActions({ layoutMode: "page", status: "pass" })).toBe(false);
    expect(shouldShowResumeEvaluationActions({ layoutMode: "page", status: "fail" })).toBe(false);
  });

  it("uses the shared badge tones and emits both evaluation decisions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onDecisionSelect = vi.fn();

    act(() => {
      root.render(<ResumeEvaluationActions onDecisionSelect={onDecisionSelect} />);
    });

    const pass = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("评估通过"),
    );
    const fail = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("评估不通过"),
    );
    expect(pass?.className).toContain("border-emerald-500/30");
    expect(fail?.className).toContain("border-rose-500/30");

    act(() => {
      pass?.click();
      fail?.click();
    });
    expect(onDecisionSelect).toHaveBeenNthCalledWith(1, "pass");
    expect(onDecisionSelect).toHaveBeenNthCalledWith(2, "fail");

    act(() => root.unmount());
  });

  it("submits an evaluation failure through the existing evaluation endpoint", async () => {
    apiMocks.submitResumeReviewEvaluation.mockResolvedValue({ id: "resume-1" });
    const { onDecisionChange, onSubmitted, root } = renderDialog("fail");

    const reason = document.querySelector<HTMLTextAreaElement>("#resume-review-evaluation-reason");
    act(() => {
      if (reason) {
        setInputValue(reason, "岗位经验不匹配");
      }
    });

    const submit = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("提交评估"),
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(apiMocks.submitResumeReviewEvaluation).toHaveBeenCalledWith("workspace-1", "resume-1", {
      availableTimeSlots: [],
      reason: "岗位经验不匹配",
      status: "fail",
    });
    expect(onSubmitted).toHaveBeenCalledWith({ id: "resume-1" });
    expect(onDecisionChange).toHaveBeenCalledWith(null);

    act(() => root.unmount());
  });

  it("keeps passed evaluations on the existing available-time flow", async () => {
    apiMocks.submitResumeReviewEvaluation.mockResolvedValue({ id: "resume-1" });
    const { root } = renderDialog("pass");

    const reason = document.querySelector<HTMLTextAreaElement>("#resume-review-evaluation-reason");
    const startAt = document.querySelector<HTMLInputElement>("#slot-start-0");
    const endAt = document.querySelector<HTMLInputElement>("#slot-end-0");
    act(() => {
      if (reason && startAt && endAt) {
        setInputValue(reason, "符合岗位要求");
        setInputValue(startAt, "2026-07-29T10:00");
        setInputValue(endAt, "2026-07-29T11:00");
      }
    });

    const submit = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("提交评估"),
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(apiMocks.submitResumeReviewEvaluation).toHaveBeenCalledWith("workspace-1", "resume-1", {
      availableTimeSlots: [
        {
          endAt: new Date("2026-07-29T11:00").toISOString(),
          startAt: new Date("2026-07-29T10:00").toISOString(),
        },
      ],
      reason: "符合岗位要求",
      status: "pass",
    });

    act(() => root.unmount());
  });
});
