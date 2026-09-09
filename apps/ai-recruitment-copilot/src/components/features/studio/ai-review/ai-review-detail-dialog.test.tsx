// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiReviewDetailDialog } from "./ai-review-detail-dialog";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  error: vi.fn(),
  get: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "ai-review": { ":id": { $get: mocks.get, approve: { $post: mocks.approve } } },
          },
        },
      },
    },
  },
}));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: Promise<unknown>) => request }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "workspace-a" }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    children,
    footer,
    title,
    open,
  }: {
    children: ReactNode;
    footer: ReactNode;
    title: ReactNode;
    open: boolean;
  }) =>
    open ? (
      <div>
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("../resumes/resume-overview-panel", () => ({
  ResumeOverviewPanel: ({
    detail,
    onViewAiScore,
  }: {
    detail: { candidateName: string };
    onViewAiScore: () => void;
  }) => (
    <div>
      概览：{detail.candidateName}
      <button type="button" onClick={onViewAiScore}>
        查看评分
      </button>
    </div>
  ),
  ResumeReviewStructuredView: ({ review }: { review: { summary: string } }) => (
    <p>{review.summary}</p>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
const clients: QueryClient[] = [];
const ready = {
  canApproveAiReview: true,
  candidateName: "候选人甲",
  resumeReview: { summary: "AI 分析内容" },
  resumeReviewStatus: "ready",
};

async function render(initialTab: "overview" | "ai-review" = "overview") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  clients.push(client);
  const onApproved = vi.fn();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <AiReviewDetailDialog
          recordId="candidate-a"
          initialTab={initialTab}
          onClose={vi.fn()}
          onApproved={onApproved}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await delay(0);
  });
  return { host, onApproved };
}
function approvalButton() {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "审批通过",
  );
}
async function confirmApproval() {
  act(() => approvalButton()?.click());
  expect(mocks.approve).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "确认审批通过",
  );
  if (!confirm || !document.querySelector("textarea")) {
    throw new Error("Missing approval form");
  }
  expect(confirm.disabled).toBe(true);
  const textarea = document.querySelector("textarea");
  if (!textarea) {
    throw new Error("Missing approval explanation");
  }
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      "  已核实项目经验  ",
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    confirm.click();
    await delay(0);
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(ready);
  mocks.approve.mockResolvedValue({ ok: true });
});
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  for (const client of clients.splice(0)) {
    client.clear();
  }
  document.body.innerHTML = "";
});

describe("AI approval detail", () => {
  it("cancels approval without changing the candidate", async () => {
    await render();
    act(() => approvalButton()?.click());
    act(() =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "取消")
        ?.click(),
    );
    expect(document.querySelector("textarea")).toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("opens candidate overview and AI review from their table actions", async () => {
    const { host } = await render("ai-review");
    expect(host.textContent).toContain("AI 分析内容");
    expect(host.textContent).toContain("候选人甲 · AI 分析审批");
  });
  it("does not show approval for a reader without source permission", async () => {
    mocks.get.mockResolvedValue({ ...ready, canApproveAiReview: false });
    const { host } = await render();
    expect(host.textContent).toContain("概览：候选人甲");
    expect(approvalButton()).toBeUndefined();
  });
  it("disables approval while AI analysis is processing", async () => {
    mocks.get.mockResolvedValue({ ...ready, resumeReviewStatus: "processing" });
    await render();
    expect(approvalButton()?.disabled).toBe(true);
  });
  it("approves the selected candidate and tells the queue to refresh", async () => {
    const { onApproved } = await render();
    await confirmApproval();
    expect(mocks.approve).toHaveBeenCalledWith({
      json: { approvalNote: "已核实项目经验" },
      param: { id: "candidate-a", slug: "workspace-a" },
    });
    expect(onApproved).toHaveBeenCalledOnce();
  });
  it("keeps the record open when permission has been revoked", async () => {
    mocks.approve.mockRejectedValue(new Error("审批权限已撤销"));
    const { onApproved } = await render();
    await confirmApproval();
    expect(mocks.error).toHaveBeenCalledWith("审批权限已撤销");
    expect(onApproved).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")?.value).toBe("  已核实项目经验  ");
  });
});
