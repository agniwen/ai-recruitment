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
  recipients: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "ai-review": {
              ":id": {
                $get: mocks.get,
                approve: { $post: mocks.approve },
                "notification-recipients": { $get: mocks.recipients },
              },
            },
          },
        },
      },
    },
  },
}));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: Promise<unknown>) => request }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "workspace-a" }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
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
  await vi.waitFor(async () => {
    await act(async () => {
      await delay(0);
    });
    expect(host.textContent).toContain("候选人甲 · AI 分析审批");
  });
  return { host, onApproved };
}
function approvalButton() {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "审批通过",
  );
}
async function confirmApproval(note = "  已核实项目经验  ") {
  act(() => approvalButton()?.click());
  expect(mocks.approve).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "确认审批通过",
  );
  if (!confirm || !document.querySelector("textarea")) {
    throw new Error("Missing approval form");
  }
  expect(confirm.disabled).toBe(true);
  await vi.waitFor(async () => {
    await act(async () => {
      await delay(0);
    });
    expect(document.querySelector('option[value="notify-a"]')).not.toBeNull();
  });
  act(() => {
    const select = document.querySelector("select");
    if (!select) {
      throw new Error("Missing notification user selector");
    }
    select.value = "notify-a";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(confirm.disabled).toBe(false);
  const textarea = document.querySelector("textarea");
  if (!textarea) {
    throw new Error("Missing approval explanation");
  }
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      note,
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
  mocks.recipients.mockResolvedValue({
    recipients: [
      { email: "odc@example.com", name: "ODC甲", telegramBound: true, userId: "notify-a" },
    ],
  });
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
  it("does not show approval for a reader without role approval permission", async () => {
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
      json: { approvalNote: "已核实项目经验", notificationUserId: "notify-a" },
      param: { id: "candidate-a", slug: "workspace-a" },
    });
    expect(onApproved).toHaveBeenCalledOnce();
  });
  it("submits a selected notification user with an empty optional note", async () => {
    await render();
    await confirmApproval("");
    expect(mocks.approve).toHaveBeenCalledWith({
      json: { approvalNote: "", notificationUserId: "notify-a" },
      param: { id: "candidate-a", slug: "workspace-a" },
    });
  });
  it("cannot approve when no bound ODC user is available", async () => {
    mocks.recipients.mockResolvedValue({
      recipients: [
        { email: "other@example.com", name: "ODC乙", telegramBound: false, userId: "unbound" },
      ],
    });
    await render();
    act(() => approvalButton()?.click());
    await vi.waitFor(async () => {
      await act(async () => {
        await delay(0);
      });
      expect(document.body.textContent).toContain("暂无可通知人员");
    });
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "确认审批通过",
    );
    expect(confirm?.disabled).toBe(true);
    expect(document.querySelector("textarea")?.required).toBe(false);
    expect(mocks.approve).not.toHaveBeenCalled();
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
