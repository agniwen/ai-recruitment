// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResumeSourceChildrenModal } from "./resume-source-children-modal";
import type { SourceChildKind } from "./resume-source-children-modal";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  options: vi.fn(),
  permissions: new Set<string>(),
}));
vi.mock("@/hooks/use-has-permission", () => ({
  useHasPermission: (resource: string, action: string) =>
    mocks.permissions.has(`${resource}:${action}`),
}));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            departments: { $get: mocks.get },
            "hiring-units": { $get: mocks.get },
            "job-descriptions": { $get: mocks.get },
          },
        },
      },
    },
  },
}));
vi.mock("@/lib/start/studio/job-descriptions.functions", () => ({
  loadStudioJobDescriptionsState: mocks.options,
}));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      {title}
      {children}
    </div>
  ),
}));
vi.mock("../hiring-units/hiring-unit-form-dialog", () => ({
  HiringUnitFormDialog: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>保存用人组织</button>
  ),
}));
vi.mock("../departments/department-form-dialog", () => ({
  DepartmentFormDialog: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>保存部门</button>
  ),
}));
vi.mock("../job-descriptions/job-description-form-dialog", () => ({
  JobDescriptionFormDialog: ({ readOnly, onSaved }: { readOnly: boolean; onSaved: () => void }) =>
    readOnly ? <p>只读岗位详情</p> : <button onClick={onSaved}>保存岗位</button>,
}));
vi.mock("@/components/data-grid", () => ({
  DataGrid: ({
    columns,
    data,
    pagination,
  }: {
    columns: ({
      inline?: { label: string; show?: () => boolean; onClick: (row: unknown) => void }[];
    } | null)[];
    data: unknown[];
    pagination: { onPageChange: (page: number) => void };
  }) => (
    <div>
      {data.map((row, index) => (
        <div key={index}>
          {columns
            .flatMap((column) => column?.inline ?? [])
            .filter((action) => !action.show || action.show())
            .map((action) => (
              <button key={action.label} onClick={() => action.onClick(row)}>
                {action.label}
              </button>
            ))}
        </div>
      ))}
      <button onClick={() => pagination.onPageChange(2)}>下一页</button>
    </div>
  ),
  actionsColumn: (options: unknown) => options,
  textColumn: () => null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
function button(label: string) {
  return [...document.querySelectorAll("button")].find((item) => item.textContent === label);
}
async function render(kind: SourceChildKind) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChanged = vi.fn();
  await act(async () => {
    await Promise.resolve();
    root.render(
      <QueryClientProvider client={client}>
        <ResumeSourceChildrenModal
          kind={kind}
          source={{ id: "source-a", name: "来源甲" }}
          onClose={vi.fn()}
          onChanged={onChanged}
        />
      </QueryClientProvider>,
    );
  });
  return onChanged;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set([
    "page:hiringUnits",
    "page:departments",
    "page:jobDescriptions",
    "hiringUnit:read",
    "department:read",
    "jd:read",
  ]);
  mocks.get.mockResolvedValue({
    records: [{ description: "描述甲", id: "child-a", name: "名称甲" }],
    total: 11,
    totalPages: 2,
  });
  mocks.options.mockResolvedValue({ departments: [], interviewers: [], status: "ready" });
});
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  document.body.innerHTML = "";
});
it.each(["hiringUnit", "department", "jd"] as const)(
  "paginates %s within the source and hides edit for readers",
  async (kind) => {
    await render(kind);
    await vi.waitFor(() => expect(button("查看")).toBeDefined());
    expect(button("编辑")).toBeUndefined();
    expect(mocks.get).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ page: "1", resumeSourceId: "source-a" }),
      }),
    );
    await act(async () => {
      button("下一页")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(mocks.get).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ page: "2", resumeSourceId: "source-a" }),
        }),
      ),
    );
  },
);
it.each(["page:departments", "department:read"])(
  "does not fetch or show actions without %s",
  async (permission) => {
    mocks.permissions.delete(permission);
    await render("department");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(button("查看")).toBeUndefined();
  },
);
it.each([
  ["hiringUnit", "保存用人组织"],
  ["department", "保存部门"],
  ["jd", "保存岗位"],
] as const)("edits %s and refreshes after saving", async (kind, label) => {
  mocks.permissions.add(`${kind}:update`);
  const changed = await render(kind);
  await vi.waitFor(() => expect(button("编辑")).toBeDefined());
  await act(async () => {
    button("编辑")?.click();
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(button(label)).toBeDefined());
  await act(async () => {
    button(label)?.click();
    await Promise.resolve();
  });
  expect(changed).toHaveBeenCalledOnce();
});
it("opens the existing job form read-only for viewers", async () => {
  await render("jd");
  await vi.waitFor(() => expect(button("查看")).toBeDefined());
  await act(async () => {
    button("查看")?.click();
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("只读岗位详情"));
});
