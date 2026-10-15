// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JobMatchingIndexButton } from "./job-matching-index-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  rebuild: vi.fn(),
  retryFailed: vi.fn(),
  session: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/lib/client/auth-client", () => ({ authClient: { useSession: mocks.session } }));
vi.mock("@/hooks/use-has-permission", () => ({ useHasPermission: mocks.permission }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@/lib/client/api/endpoints/job-matching-index", () => ({
  getJobMatchingIndexStatus: mocks.status,
  rebuildJobMatchingIndex: mocks.rebuild,
  retryFailedJobMatchingIndex: mocks.retryFailed,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    open,
    title,
    description,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    description: string;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    open ? (
      <dialog open aria-label={title}>
        <p>{description}</p>
        {children}
        {footer}
      </dialog>
    ) : null,
}));

let root: ReturnType<typeof createRoot> | null = null;
let client: QueryClient | null = null;
const status = {
  configurationError: null,
  failed: 0,
  indexed: 450,
  pending: 0,
  profiles: 450,
  total: 450,
  vectorError: null,
  vectorPoints: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ data: { user: { role: "admin" } }, isPending: false });
  mocks.permission.mockReturnValue(true);
  mocks.status.mockResolvedValue(status);
  mocks.rebuild.mockResolvedValue({ queued: 450 });
  mocks.retryFailed.mockResolvedValue({ queued: 11 });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = null;
  client?.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: 2 }, queries: { retry: false } },
  });
  client = queryClient;
  await act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <JobMatchingIndexButton />
      </QueryClientProvider>,
    ),
  );
  await act(() => delay(15));
}
const button = (label: string) =>
  [
    ...(
      document.querySelector('[role="alertdialog"]') ??
      document.querySelector("dialog") ??
      document
    ).querySelectorAll("button"),
  ].find((item) => item.textContent === label);
async function openControl() {
  await render();
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
}
async function openRebuildConfirmation() {
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
}
it.each(["user", "owner", null])(
  "hides maintenance and sends no index request for account role %s",
  async (role) => {
    mocks.session.mockReturnValue({ data: role ? { user: { role } } : null, isPending: false });
    await render();
    expect(document.querySelector("button")).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  },
);
it("reads the actual point count inside the modal and creates absent vectors despite copied DB markers", async () => {
  await render();
  expect(mocks.status).not.toHaveBeenCalled();
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
  expect(mocks.status).toHaveBeenCalledWith("work");
  expect(button("重建向量")?.disabled).toBe(false);
  expect(document.querySelector("dl")?.textContent).toContain("Qdrant 实际向量点数0");
  await openRebuildConfirmation();
  expect(mocks.rebuild).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("450");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("模型调用费用");
  await act(() => button("确认重建")?.click());
  await act(() => delay(15));
  expect(mocks.rebuild).toHaveBeenCalledWith("work");
  expect(document.querySelector("dialog")).toBeNull();
  expect(mocks.status).toHaveBeenCalledOnce();
});
it("cancels the full rebuild confirmation without submitting or closing the status modal", async () => {
  await openControl();
  await openRebuildConfirmation();
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(document.activeElement?.textContent).toBe("取消");
  await act(() => button("取消")?.click());
  await act(() => delay(40));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector("dialog")).not.toBeNull();
  expect(document.activeElement?.textContent).toBe("重建向量");
  expect(mocks.rebuild).not.toHaveBeenCalled();
  expect(mocks.retryFailed).not.toHaveBeenCalled();
});
it("dismisses the confirmation with Escape without submitting a rebuild", async () => {
  await openControl();
  await openRebuildConfirmation();
  await act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
  });
  await act(() => delay(40));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector("dialog")).not.toBeNull();
  expect(mocks.rebuild).not.toHaveBeenCalled();
});
it("offers rebuilding when Qdrant already has vectors", async () => {
  mocks.status.mockResolvedValue({ ...status, vectorPoints: 1350 });
  await openControl();
  expect(button("重建向量")?.disabled).toBe(false);
});
it("blocks creation when required infrastructure is unavailable", async () => {
  mocks.status.mockResolvedValue({
    ...status,
    configurationError: "后台队列尚未配置",
    failed: 11,
  });
  await openControl();
  expect(document.body.textContent).toContain("后台队列尚未配置");
  expect(button("重建向量")?.disabled).toBe(true);
  expect(button("重试")?.disabled).toBe(true);
  expect(mocks.rebuild).not.toHaveBeenCalled();
});
it("shows retry next to the failure count and sends only a failed-job request", async () => {
  mocks.status.mockResolvedValue({ ...status, failed: 11 });
  await openControl();
  expect(button("重试")?.closest("div")?.textContent).toContain("处理失败");
  expect(button("重试")?.closest("div")?.textContent).toContain("11");
  await act(() => button("重试")?.click());
  await act(() => delay(15));
  expect(mocks.retryFailed).toHaveBeenCalledWith("work");
  expect(mocks.rebuild).not.toHaveBeenCalled();
  expect(document.querySelector("dialog")).toBeNull();
});
it("does not offer retry when there are no failed jobs", async () => {
  await openControl();
  expect(button("重试")).toBeUndefined();
  expect(mocks.retryFailed).not.toHaveBeenCalled();
});
it("allows the rebuild path to repair a collection whose point count cannot be read", async () => {
  mocks.status.mockResolvedValue({ ...status, vectorError: "无法读取 Qdrant", vectorPoints: null });
  await openControl();
  expect(button("重建向量")?.disabled).toBe(false);
});
it.each([false, true])(
  "deduplicates 50 rapid clicks and closes on success (failedOnly: %s)",
  async (failedOnly) => {
    mocks.status.mockResolvedValue({ ...status, failed: failedOnly ? 11 : 0 });
    await openControl();
    const pending = Promise.withResolvers<{ queued: number }>();
    const action = failedOnly ? mocks.retryFailed : mocks.rebuild;
    action.mockReturnValueOnce(pending.promise);
    if (!failedOnly) {
      await openRebuildConfirmation();
      expect(action).not.toHaveBeenCalled();
    }
    const submit = button(failedOnly ? "重试" : "确认重建");
    await act(() => {
      for (let index = 0; index < 50; index += 1) {
        submit?.click();
      }
      if (failedOnly) {
        button("重建向量")?.click();
      }
    });
    await act(() => delay(15));
    expect(action).toHaveBeenCalledOnce();
    expect(button("正在提交…")?.disabled).toBe(true);
    if (failedOnly) {
      expect(button("重建向量")?.disabled).toBe(true);
      expect(mocks.rebuild).not.toHaveBeenCalled();
    }
    expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
    await act(() => pending.resolve({ queued: 450 }));
    await act(() => delay(15));
    expect(document.querySelector("dialog")).toBeNull();
    expect(action).toHaveBeenCalledOnce();
  },
);
it.each([false, true])(
  "closes when no jobs remain to queue (failedOnly: %s)",
  async (failedOnly) => {
    mocks.status.mockResolvedValue({ ...status, failed: failedOnly ? 11 : 0 });
    const action = failedOnly ? mocks.retryFailed : mocks.rebuild;
    action.mockResolvedValueOnce({ queued: 0 });
    await openControl();
    if (!failedOnly) {
      await openRebuildConfirmation();
    }
    await act(() => button(failedOnly ? "重试" : "确认重建")?.click());
    await act(() => delay(15));
    expect(document.querySelector("dialog")).toBeNull();
    expect(action).toHaveBeenCalledOnce();
  },
);
it.each([false, true])(
  "keeps failures open and throttles manual retries without automatic requests (failedOnly: %s)",
  async (failedOnly) => {
    mocks.status.mockResolvedValue({ ...status, failed: failedOnly ? 11 : 0 });
    const label = failedOnly ? "重试" : "确认重建";
    const action = failedOnly ? mocks.retryFailed : mocks.rebuild;
    await openControl();
    if (!failedOnly) {
      await openRebuildConfirmation();
    }
    const submittedAt = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(submittedAt);
    action.mockRejectedValueOnce(new Error("队列暂不可用"));
    await act(() => button(label)?.click());
    await act(() => delay(15));
    expect(document.querySelector("dialog")).not.toBeNull();
    expect(button(label)?.disabled).toBe(false);
    now.mockReturnValue(submittedAt + 500);
    await act(() => button(label)?.click());
    await act(() => delay(15));
    expect(action).toHaveBeenCalledOnce();
    now.mockReturnValue(submittedAt + 1500);
    await act(() => delay(1100));
    expect(action).toHaveBeenCalledOnce();
    expect(document.querySelector("dialog")).not.toBeNull();
    await act(() => button(label)?.click());
    await act(() => delay(15));
    expect(action).toHaveBeenCalledTimes(2);
    expect(document.querySelector("dialog")).toBeNull();
  },
);
