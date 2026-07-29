// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResumeEvaluationActions,
  ResumeEvaluationDialog,
  ResumeReviewEvaluationBar,
  shouldShowResumeEvaluationActions,
} from "./resume-evaluation-dialog";

const apiMocks = vi.hoisted(() => ({
  submitResumeReviewEvaluation: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  isApiError: (error: unknown) =>
    error instanceof Error && "status" in error && typeof error.status === "number",
  submitResumeReviewEvaluation: apiMocks.submitResumeReviewEvaluation,
}));

vi.mock("@/components/date-time-picker", () => ({
  DateTimePicker: ({
    id,
    onValueChange,
    value,
  }: {
    id?: string;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <input
      aria-label={id}
      data-slot="date-time-picker"
      id={id}
      onChange={(event) => onValueChange(event.target.value)}
      type="text"
      value={value}
    />
  ),
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
  it("hides member-review evaluation actions until a job is bound", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ResumeReviewEvaluationBar
            hasJobDescription={false}
            isLoading={false}
            recordId="resume-1"
            status={null}
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).not.toContain("评估通过");
    expect(container.textContent).not.toContain("评估不通过");
    act(() => root.unmount());
  });

  it("shows actions on page details until an evaluation passes", () => {
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "page",
        status: null,
      }),
    ).toBe(true);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "page",
        pipelineStage: "screening",
        status: null,
      }),
    ).toBe(true);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: false,
        layoutMode: "page",
        status: null,
      }),
    ).toBe(false);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "modal",
        status: null,
      }),
    ).toBe(false);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "page",
        status: undefined,
      }),
    ).toBe(false);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "page",
        status: "pass",
      }),
    ).toBe(false);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "page",
        status: "fail",
      }),
    ).toBe(true);
    expect(
      shouldShowResumeEvaluationActions({
        hasJobDescription: true,
        layoutMode: "page",
        pipelineStage: "closed",
        status: null,
      }),
    ).toBe(false);
  });

  it("keeps the current fail result visible while allowing another reviewer to evaluate", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ResumeReviewEvaluationBar
            hasJobDescription={true}
            isLoading={false}
            recordId="resume-1"
            status="fail"
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("评估结果");
    expect(container.textContent).toContain("不通过");
    expect(container.textContent).toContain("评估通过");
    expect(container.textContent).toContain("评估不通过");
    act(() => root.unmount());
  });

  it("keeps pass terminal and hides further evaluation actions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ResumeReviewEvaluationBar
            hasJobDescription={true}
            isLoading={false}
            recordId="resume-1"
            status="pass"
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("评估结果");
    expect(container.textContent).toContain("通过");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    act(() => root.unmount());
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
    expect(fail?.className).toContain("!border-l");

    act(() => {
      pass?.click();
      fail?.click();
    });
    expect(onDecisionSelect).toHaveBeenNthCalledWith(1, "pass");
    expect(onDecisionSelect).toHaveBeenNthCalledWith(2, "fail");

    act(() => root.unmount());
  });

  it("requires department and reason before submitting an evaluation", async () => {
    const { toast } = await import("sonner");
    const { root } = renderDialog("fail");
    const submit = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("提交评估"),
    );

    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalledWith("请填写评审部门");
    expect(apiMocks.submitResumeReviewEvaluation).not.toHaveBeenCalled();

    const department = document.querySelector<HTMLInputElement>(
      "#resume-review-evaluation-department",
    );
    act(() => {
      if (department) {
        setInputValue(department, "研发部");
      }
    });
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalledWith("请填写评估原因");
    expect(apiMocks.submitResumeReviewEvaluation).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("submits an evaluation failure through the existing evaluation endpoint", async () => {
    apiMocks.submitResumeReviewEvaluation.mockResolvedValue({ id: "resume-1" });
    const { onDecisionChange, onSubmitted, root } = renderDialog("fail");

    const department = document.querySelector<HTMLInputElement>(
      "#resume-review-evaluation-department",
    );
    const reason = document.querySelector<HTMLTextAreaElement>("#resume-review-evaluation-reason");
    act(() => {
      if (department && reason) {
        setInputValue(department, "研发部");
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
      departmentName: "研发部",
      reason: "岗位经验不匹配",
      status: "fail",
    });
    expect(onSubmitted).toHaveBeenCalledWith({ id: "resume-1" });
    expect(onDecisionChange).toHaveBeenCalledWith(null);

    act(() => root.unmount());
  });

  it("refreshes the detail and closes a stale dialog after another reviewer passes", async () => {
    apiMocks.submitResumeReviewEvaluation.mockRejectedValue(
      Object.assign(new Error("该简历已评估通过，不能继续评估。"), { status: 409 }),
    );
    const { onDecisionChange, queryClient, root } = renderDialog("fail");
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const department = document.querySelector<HTMLInputElement>(
      "#resume-review-evaluation-department",
    );
    const reason = document.querySelector<HTMLTextAreaElement>("#resume-review-evaluation-reason");
    act(() => {
      if (department && reason) {
        setInputValue(department, "产品部");
        setInputValue(reason, "仍不符合要求");
      }
    });

    const submit = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("提交评估"),
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(onDecisionChange).toHaveBeenCalledWith(null);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["studio-resumes", "workspace-1"],
    });
    act(() => root.unmount());
  });

  it("keeps passed evaluations on the existing available-time flow", async () => {
    apiMocks.submitResumeReviewEvaluation.mockResolvedValue({ id: "resume-1" });
    const { root } = renderDialog("pass");

    const department = document.querySelector<HTMLInputElement>(
      "#resume-review-evaluation-department",
    );
    const reason = document.querySelector<HTMLTextAreaElement>("#resume-review-evaluation-reason");
    const startAt = document.querySelector<HTMLInputElement>("#slot-start-0");
    const endAt = document.querySelector<HTMLInputElement>("#slot-end-0");
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(document.querySelectorAll('[data-slot="date-time-picker"]')).toHaveLength(2);
    act(() => {
      if (department && reason && startAt && endAt) {
        setInputValue(department, "用人部门");
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
      departmentName: "用人部门",
      reason: "符合岗位要求",
      status: "pass",
    });

    act(() => root.unmount());
  });
});
