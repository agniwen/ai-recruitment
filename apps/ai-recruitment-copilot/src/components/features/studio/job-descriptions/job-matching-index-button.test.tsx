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
  session: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/lib/client/auth-client", () => ({ authClient: { useSession: mocks.session } }));
vi.mock("@/hooks/use-has-permission", () => ({ useHasPermission: mocks.permission }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@/lib/client/api/endpoints/job-matching-index", () => ({
  getJobMatchingIndexStatus: mocks.status,
  rebuildJobMatchingIndex: mocks.rebuild,
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
  [...(document.querySelector("dialog") ?? document).querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
async function openControl() {
  await render();
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
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
  expect(mocks.rebuild).toHaveBeenCalledWith("work");
  expect(document.querySelector("dialog")).toBeNull();
  expect(mocks.status).toHaveBeenCalledOnce();
});
it("offers rebuilding when Qdrant already has vectors", async () => {
  mocks.status.mockResolvedValue({ ...status, vectorPoints: 1350 });
  await openControl();
  expect(button("重建向量")?.disabled).toBe(false);
});
it("blocks creation when required infrastructure is unavailable", async () => {
  mocks.status.mockResolvedValue({ ...status, configurationError: "后台队列尚未配置" });
  await openControl();
  expect(document.body.textContent).toContain("后台队列尚未配置");
  expect(button("重建向量")?.disabled).toBe(true);
  expect(mocks.rebuild).not.toHaveBeenCalled();
});
it("allows the rebuild path to repair a collection whose point count cannot be read", async () => {
  mocks.status.mockResolvedValue({ ...status, vectorError: "无法读取 Qdrant", vectorPoints: null });
  await openControl();
  expect(button("重建向量")?.disabled).toBe(false);
});
it("sends one request for 50 rapid clicks and closes as soon as the request succeeds", async () => {
  await openControl();
  const pending = Promise.withResolvers<{ queued: number }>();
  mocks.rebuild.mockReturnValueOnce(pending.promise);
  const submit = button("重建向量");
  await act(() => {
    for (let index = 0; index < 50; index += 1) {
      submit?.click();
    }
  });
  await act(() => delay(15));
  expect(mocks.rebuild).toHaveBeenCalledOnce();
  expect(button("正在提交…")?.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  await act(() => pending.resolve({ queued: 450 }));
  await act(() => delay(15));
  expect(document.querySelector("dialog")).toBeNull();
  expect(mocks.rebuild).toHaveBeenCalledOnce();
});
it("also closes when a successful request queues no jobs", async () => {
  mocks.rebuild.mockResolvedValueOnce({ queued: 0 });
  await openControl();
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
  expect(document.querySelector("dialog")).toBeNull();
  expect(mocks.rebuild).toHaveBeenCalledOnce();
});
it("keeps failures open for retry and throttles attempts within one second without automatic retries", async () => {
  await openControl();
  const submittedAt = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(submittedAt);
  mocks.rebuild.mockRejectedValueOnce(new Error("队列暂不可用"));
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
  expect(document.querySelector("dialog")).not.toBeNull();
  expect(button("重建向量")?.disabled).toBe(false);
  now.mockReturnValue(submittedAt + 500);
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
  expect(mocks.rebuild).toHaveBeenCalledOnce();
  now.mockReturnValue(submittedAt + 1500);
  await act(() => delay(1100));
  expect(mocks.rebuild).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")).not.toBeNull();
  await act(() => button("重建向量")?.click());
  await act(() => delay(15));
  expect(mocks.rebuild).toHaveBeenCalledTimes(2);
  expect(document.querySelector("dialog")).toBeNull();
});
