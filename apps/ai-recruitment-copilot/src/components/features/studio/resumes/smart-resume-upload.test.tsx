// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SmartResumeUpload } from "./smart-resume-upload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/client/auth-client", () => ({ authClient: { useSession: mocks.session } }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@/lib/client/api/endpoints/smart-resume-upload", () => ({
  createSmartResumeTask: mocks.create,
  listSmartResumeTasks: mocks.list,
}));
vi.mock("@/lib/client/api/endpoints/bulk-resume-upload", () => ({ uploadResumeForBulk: vi.fn() }));
vi.mock("./smart-resume-task-dialog", () => ({ SmartResumeTaskDialog: () => null }));
vi.mock("@/components/ui/file-upload", () => ({ FileUpload: () => null }));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    open,
    title,
    headerExtra,
    children,
  }: {
    open: boolean;
    title: string;
    headerExtra: ReactNode;
    children: ReactNode;
  }) =>
    open ? (
      <dialog open aria-label={title}>
        {headerExtra}
        {children}
      </dialog>
    ) : null,
}));

let root: ReturnType<typeof createRoot> | null = null;
let client: QueryClient | null = null;
beforeEach(() => {
  mocks.session.mockReturnValue({ data: { user: { role: "admin" } }, isPending: false });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = null;
  client?.clear();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});
async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client = queryClient;
  await act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <SmartResumeUpload onSubmitted={vi.fn()} />
      </QueryClientProvider>,
    ),
  );
  await act(() => delay(15));
}

it("loads the task count before opening and keeps the task list inside the upload modal", async () => {
  mocks.list.mockResolvedValue({
    tasks: [
      { createdAt: "2026-10-15T00:00:00Z", failed: 0, id: "first", ready: 1, total: 6 },
      { createdAt: "2026-10-15T00:00:00Z", failed: 0, id: "second", ready: 1, total: 1 },
    ],
  });
  await render();
  expect(mocks.list).toHaveBeenCalledWith("work");
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="智能上传，2 个待提交任务"]',
  );
  expect(trigger).not.toBeNull();
  expect(trigger?.querySelector('[data-slot="badge"]')?.textContent).toBe("2");
  expect(trigger?.querySelector('[data-slot="badge"]')?.className).toContain("bg-destructive");
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.body.textContent).not.toContain("待提交任务");
  await act(() => trigger?.click());
  expect(document.querySelector('dialog[aria-label="智能上传简历"]')?.textContent).toContain(
    "待提交任务（2）",
  );
});

it("removes the badge when the submitted task is invalidated out of the list", async () => {
  mocks.list.mockResolvedValue({
    tasks: [{ createdAt: "2026-10-15T00:00:00Z", failed: 0, id: "task", ready: 1, total: 1 }],
  });
  await render();
  expect(document.querySelector('[data-slot="badge"]')?.textContent).toBe("1");
  mocks.list.mockResolvedValue({ tasks: [] });
  await act(async () => {
    await client?.invalidateQueries({ queryKey: ["smart-resume-tasks", "work"] });
  });
  await act(() => delay(15));
  expect(document.querySelector('[data-slot="badge"]')).toBeNull();
  expect(document.querySelector('button[aria-label="智能上传"]')).not.toBeNull();
});

it.each(["user", null])(
  "hides smart upload and makes no task request for account role %s",
  async (role) => {
    mocks.session.mockReturnValue({ data: role ? { user: { role } } : null, isPending: false });
    await render();
    expect(document.querySelector("button")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it("keeps smart upload hidden while platform identity is loading", async () => {
  mocks.session.mockReturnValue({ data: { user: { role: "admin" } }, isPending: true });
  await render();
  expect(document.querySelector("button")).toBeNull();
  expect(mocks.list).not.toHaveBeenCalled();
});
