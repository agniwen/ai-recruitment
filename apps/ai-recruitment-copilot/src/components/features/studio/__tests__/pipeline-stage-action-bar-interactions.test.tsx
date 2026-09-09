// @vitest-environment jsdom

import type { PipelineStage } from "@arc/db-schema/studio-interviews";
import { act } from "react";
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineStageActionBar } from "../pipeline-stage-action-bar";

const clients: QueryClient[] = [];
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "workspace-a" }));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: Promise<unknown>) => request }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "ai-review": {
              ":id": {
                "notification-recipients": {
                  $get: () =>
                    Promise.resolve({
                      recipients: [
                        {
                          email: "odc@example.com",
                          name: "ODC甲",
                          telegramBound: true,
                          userId: "notify-a",
                        },
                      ],
                    }),
                },
              },
            },
          },
        },
      },
    },
  },
}));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    id,
    value,
    onChange,
    options,
    disabled,
    required,
  }: {
    id: string;
    value: string | null;
    onChange: (value: string | null) => void;
    options: { value: string; label: string; disabled?: boolean }[];
    disabled?: boolean;
    required?: boolean;
  }) => (
    <select
      id={id}
      value={value ?? ""}
      disabled={disabled}
      required={required}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">请选择通知人员</option>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const copyInterviewLinkMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/features/studio/interviews/interview-link-actions", () => ({
  copyInterviewLink: copyInterviewLinkMock,
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];

function renderActionBar({
  canApproveAiReview,
  aiReviewReady,
  aiRoundInterviewLink,
  aiInterviewDisabled,
  evaluationActions,
  hasJobDescription,
  missingJobAction,
  onAdvance = vi.fn(),
  pipelineStage = "ai_interview",
  primaryAction,
  resumeEvaluationPassed,
}: {
  canApproveAiReview?: boolean;
  aiReviewReady?: boolean;
  aiRoundInterviewLink?: string;
  aiInterviewDisabled?: boolean;
  evaluationActions?: ReactNode;
  hasJobDescription?: boolean;
  missingJobAction?: ReactNode;
  onAdvance?: (target: PipelineStage) => void | Promise<void>;
  pipelineStage?: PipelineStage;
  primaryAction?: ReactNode;
  resumeEvaluationPassed?: boolean;
} = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push({ host, root });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <PipelineStageActionBar
          recordId="candidate-a"
          canApproveAiReview={canApproveAiReview}
          aiReviewReady={aiReviewReady}
          aiRoundInterviewLink={aiRoundInterviewLink}
          aiInterviewDisabled={aiInterviewDisabled}
          evaluationActions={evaluationActions}
          hasJobDescription={hasJobDescription}
          missingJobAction={missingJobAction}
          onAdvance={onAdvance}
          onRequestClose={vi.fn()}
          onRequestReactivate={vi.fn()}
          onViewCurrentStage={vi.fn()}
          pipelineStage={pipelineStage}
          primaryAction={primaryAction}
          resumeEvaluationPassed={resumeEvaluationPassed}
        />
      </QueryClientProvider>,
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
  for (const client of clients.splice(0)) {
    client.clear();
  }
  vi.clearAllMocks();
});

describe("PipelineStageActionBar interactions", () => {
  it("only offers AI approval to members with role approval permission", async () => {
    const unauthorized = renderActionBar({ aiReviewReady: true, pipelineStage: "ai_review" });
    expect(unauthorized.textContent).toContain("等待有审批权限的成员");
    expect(unauthorized.textContent).not.toContain("审批通过，进入简历筛选");
    const onAdvance = vi.fn();
    const authorized = renderActionBar({
      aiReviewReady: true,
      canApproveAiReview: true,
      onAdvance,
      pipelineStage: "ai_review",
    });
    await act(async () => {
      getButton(authorized, "审批通过，进入简历筛选").click();
      await Promise.resolve();
    });
    expect(getButton(authorized, "审批通过，进入简历筛选").dataset.size).toBe("sm");
    expect(onAdvance).not.toHaveBeenCalled();
    const confirm = getButton(authorized, "确认审批通过");
    expect(confirm.disabled).toBe(true);
    await vi.waitFor(async () => {
      await act(async () => {
        await delay(0);
      });
      expect(authorized.querySelector('option[value="notify-a"]')).not.toBeNull();
    });
    act(() => {
      const select = authorized.querySelector("select");
      if (!select) {
        throw new Error("Missing recipient selector");
      }
      select.value = "notify-a";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const textarea = authorized.querySelector("textarea");
    if (!textarea) {
      throw new Error("Missing approval explanation");
    }
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "已核实项目经验",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(onAdvance).toHaveBeenCalledWith("screening", "已核实项目经验", "notify-a");
  });
  it("disables approval until the AI review is ready", () => {
    const host = renderActionBar({
      aiReviewReady: false,
      canApproveAiReview: true,
      pipelineStage: "ai_review",
    });
    expect(getButton(host, "等待 AI 评价生成").disabled).toBe(true);
  });

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

  it("shows the linked-job quick-edit action when no job is bound", () => {
    const host = renderActionBar({
      hasJobDescription: false,
      missingJobAction: <button type="button">简历尚未绑定岗位</button>,
      pipelineStage: "screening",
    });

    expect(getButton(host, "简历尚未绑定岗位")).toBeDefined();
  });

  it("hides offer advancement when a legacy human-interview record has no linked job", () => {
    const host = renderActionBar({
      hasJobDescription: false,
      pipelineStage: "human_interview",
    });

    expect(host.textContent).not.toContain("进入 Offer");
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
