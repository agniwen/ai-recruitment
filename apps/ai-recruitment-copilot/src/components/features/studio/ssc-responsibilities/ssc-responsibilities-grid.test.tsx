// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  installNoopResizeObserver,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import {
  SscResponsibilitiesGrid,
  SscResponsibilityEditorDialog,
} from "./ssc-responsibilities-grid";
import type { SscResponsibilityRecord } from "./ssc-responsibilities-grid";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  error: vi.fn(),
  list: vi.fn(),
  options: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "ssc-responsibilities": {
              $get: mocks.list,
              $post: mocks.create,
              ":id": { $delete: mocks.remove, $patch: mocks.patch },
              options: { $get: mocks.options },
            },
          },
        },
      },
    },
  },
}));

enableReactActEnvironment();
const mounted: Awaited<ReturnType<typeof renderInAct>>[] = [];
const clients: QueryClient[] = [];
const record: SscResponsibilityRecord = {
  centerName: "未建中心",
  createdAt: "2026-10-17T00:00:00.000Z",
  demandOwner: "需求负责人",
  email: "ssc@example.com",
  id: "ssc-1",
  notes: "备注内容",
  resumeSourceId: null,
  resumeSourceName: null,
  sscName: "林风",
  telegram: "@ssc",
  updatedAt: "2026-10-17T00:00:00.000Z",
  workspaceRole: "ssc-01",
  workspaceRoleName: "SSC角色",
};
beforeEach(() => {
  vi.clearAllMocks();
  installNoopResizeObserver();
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })),
  );
  mocks.list.mockImplementation(() =>
    Promise.resolve(
      Response.json({ page: 1, pageSize: 20, records: [record], total: 1, totalPages: 1 }),
    ),
  );
  mocks.create.mockImplementation(() =>
    Promise.resolve(Response.json({ id: "ssc-new" }, { status: 201 })),
  );
  mocks.patch.mockImplementation(() => Promise.resolve(Response.json({ id: "ssc-1" })));
  mocks.remove.mockImplementation(() => Promise.resolve(Response.json({ success: true })));
  mocks.options.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        resumeSources: [{ id: "source-1", name: "实际业务中心" }],
        roles: [{ label: "SSC角色", value: "ssc-01" }],
      }),
    ),
  );
});
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await unmountInAct(item.root);
  }
  for (const client of clients.splice(0)) {
    client.clear();
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function mount(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  clients.push(client);
  const result = await renderInAct(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  mounted.push(result);
  return result.container;
}
async function mountGrid(search = "") {
  const root = createRootRoute({
    component: Outlet,
    validateSearch: (input: Record<string, unknown>) => input,
  });
  const index = createRoute({
    component: SscResponsibilitiesGrid,
    getParentRoute: () => root,
    path: "/",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [`/${search}`] }),
    routeTree: root.addChildren([index]),
  });
  await router.load();
  return mount(<RouterProvider router={router} />);
}
function button(label: string) {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found;
}
async function fill(id: string, value: string) {
  const input = document.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(input, id).not.toBeNull();
  await act(() => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pick(id: string, label: string) {
  await waitForUi(() => expect(document.querySelector(`#${id}`)).not.toBeNull());
  await waitForUi(() => expect(document.querySelector(`#${id}`)?.matches(":disabled")).toBe(false));
  const trigger = document.querySelector<HTMLElement>(`#${id}`);
  await act(() => {
    trigger?.click();
    if (trigger instanceof HTMLInputElement) {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    }
  });
  let option: HTMLElement | undefined;
  await waitForUi(() => {
    option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(option).toBeDefined();
  });
  await act(() => option?.click());
}

describe("SSC responsibility editor", () => {
  it("fixes the source when launched from source management and invalidates SSC and member caches", async () => {
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog
        open
        record={null}
        fixedSource={{ id: "source-1", name: "实际业务中心" }}
        onOpenChange={vi.fn()}
        onSaved={saved}
      />,
    );
    const client = clients.at(-1);
    client?.setQueryData(["studio-ssc-responsibilities", "work", "global"], { records: [] });
    client?.setQueryData(["workspace-members", "work"], { records: [] });
    const source = document.querySelector<HTMLInputElement>("#ssc-fixed-source");
    expect(source?.readOnly).toBe(true);
    expect(source?.value).toBe("实际业务中心");
    expect(document.querySelector("#ssc-resumeSourceId")).toBeNull();
    await waitForUi(() => expect(button("保存")?.disabled).toBe(false));
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        centerName: "实际业务中心",
        demandOwner: "",
        email: "",
        notes: "",
        resumeSourceId: "source-1",
        sscName: "",
        telegram: "",
        workspaceRole: "ssc-01",
      },
      param: { slug: "work" },
    });
    expect(
      client?.getQueryState(["studio-ssc-responsibilities", "work", "global"])?.isInvalidated,
    ).toBe(true);
    expect(client?.getQueryState(["workspace-members", "work"])?.isInvalidated).toBe(true);
  });

  it("saves a selected real center with the unique SSC role while contacts remain blank", async () => {
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog open record={null} onOpenChange={vi.fn()} onSaved={saved} />,
    );
    await pick("ssc-resumeSourceId", "实际业务中心");

    expect(button("保存")?.disabled).toBe(false);
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        centerName: "实际业务中心",
        demandOwner: "",
        email: "",
        notes: "",
        resumeSourceId: "source-1",
        sscName: "",
        telegram: "",
        workspaceRole: "ssc-01",
      },
      param: { slug: "work" },
    });
  });

  it("does not accept a typed center name until a real option is selected", async () => {
    await mount(
      <SscResponsibilityEditorDialog open record={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    await fill("ssc-resumeSourceId", "实际业务中心");
    await fill("ssc-sscName", "林风");
    await fill("ssc-email", "ssc@example.com");

    expect(button("保存")?.disabled).toBe(true);
    await act(() => button("保存")?.click());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows previously empty SSC details to be filled in on an existing entry", async () => {
    const saved = vi.fn();
    const incomplete = {
      ...record,
      demandOwner: "",
      email: "",
      notes: "",
      sscName: "",
      telegram: "",
    };
    await mount(
      <SscResponsibilityEditorDialog
        open
        record={incomplete}
        onOpenChange={vi.fn()}
        onSaved={saved}
      />,
    );
    for (const id of ["ssc-sscName", "ssc-email", "ssc-telegram"]) {
      expect(document.querySelector<HTMLInputElement>(`#${id}`)?.value).toBe("");
    }
    await waitForUi(() => expect(button("保存")?.disabled).toBe(false));
    await fill("ssc-sscName", "  后补SSC  ");
    await fill("ssc-email", "LATER@EXAMPLE.COM");
    await fill("ssc-telegram", "  @later  ");
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledWith({
      json: {
        centerName: "未建中心",
        demandOwner: "",
        email: "later@example.com",
        notes: "",
        resumeSourceId: null,
        sscName: "后补SSC",
        telegram: "@later",
        workspaceRole: "ssc-01",
      },
      param: { id: "ssc-1", slug: "work" },
    });
  });

  it("accepts an unregistered SSC for a selected real center with optional fields blank", async () => {
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog open record={null} onOpenChange={vi.fn()} onSaved={saved} />,
    );
    expect(button("保存")?.disabled).toBe(true);
    for (const label of ["需求对接负责人", "中心/部门", "SSC 花名", "SSC TG", "SSC 邮箱", "备注"]) {
      expect(document.body.textContent).toContain(label);
    }
    await pick("ssc-resumeSourceId", "实际业务中心");
    await fill("ssc-sscName", "  新人SSC  ");
    await fill("ssc-email", "NEW@EXAMPLE.COM");
    expect(button("保存")?.disabled).toBe(false);
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        centerName: "实际业务中心",
        demandOwner: "",
        email: "new@example.com",
        notes: "",
        resumeSourceId: "source-1",
        sscName: "新人SSC",
        telegram: "",
        workspaceRole: "ssc-01",
      },
      param: { slug: "work" },
    });
  });
  it("updates all six fields and surfaces duplicate errors without closing", async () => {
    const close = vi.fn();
    const saved = vi.fn();
    mocks.patch.mockImplementation(() =>
      Promise.resolve(Response.json({ error: "该中心与邮箱已存在负责关系" }, { status: 409 })),
    );
    await mount(
      <SscResponsibilityEditorDialog open record={record} onOpenChange={close} onSaved={saved} />,
    );
    await fill("ssc-notes", " 新备注 ");
    await waitForUi(() => expect(button("保存")?.disabled).toBe(false));
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(mocks.error).toHaveBeenCalledWith("该中心与邮箱已存在负责关系"));
    expect(mocks.patch).toHaveBeenCalledWith({
      json: {
        centerName: "未建中心",
        demandOwner: "需求负责人",
        email: "ssc@example.com",
        notes: "新备注",
        resumeSourceId: null,
        sscName: "林风",
        telegram: "@ssc",
        workspaceRole: "ssc-01",
      },
      param: { id: "ssc-1", slug: "work" },
    });
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("preserves an unmatched original center while assigning the unique SSC role and editing other fields", async () => {
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog
        open
        record={{ ...record, workspaceRole: null, workspaceRoleName: null }}
        onOpenChange={vi.fn()}
        onSaved={saved}
      />,
    );
    await waitForUi(() =>
      expect(document.querySelector("#ssc-workspaceRole")?.textContent).toContain("SSC角色"),
    );
    expect(document.body.textContent).toContain("未建中心");
    expect(document.body.textContent).toContain("待关联");
    await fill("ssc-notes", "保留原表名称");
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledWith({
      json: {
        centerName: "未建中心",
        demandOwner: "需求负责人",
        email: "ssc@example.com",
        notes: "保留原表名称",
        resumeSourceId: null,
        sscName: "林风",
        telegram: "@ssc",
        workspaceRole: "ssc-01",
      },
      param: { id: "ssc-1", slug: "work" },
    });
  });

  it("links an unmatched center to the selected real source and submits its ID", async () => {
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog open record={record} onOpenChange={vi.fn()} onSaved={saved} />,
    );
    await pick("ssc-resumeSourceId", "实际业务中心");
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.patch).toHaveBeenCalledWith({
      json: {
        centerName: "实际业务中心",
        demandOwner: "需求负责人",
        email: "ssc@example.com",
        notes: "备注内容",
        resumeSourceId: "source-1",
        sscName: "林风",
        telegram: "@ssc",
        workspaceRole: "ssc-01",
      },
      param: { id: "ssc-1", slug: "work" },
    });
  });

  it("allows choosing a specific SSC workspace role without submitting display labels", async () => {
    mocks.options.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          resumeSources: [{ id: "source-1", name: "实际业务中心" }],
          roles: [
            { label: "SSC角色", value: "ssc-01" },
            { label: "SSC二组", value: "ssc-02" },
          ],
        }),
      ),
    );
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog open record={null} onOpenChange={vi.fn()} onSaved={saved} />,
    );
    await pick("ssc-resumeSourceId", "实际业务中心");
    await pick("ssc-workspaceRole", "SSC二组");
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        centerName: "实际业务中心",
        demandOwner: "",
        email: "",
        notes: "",
        resumeSourceId: "source-1",
        sscName: "",
        telegram: "",
        workspaceRole: "ssc-02",
      },
      param: { slug: "work" },
    });
  });

  it("cannot save without an available SSC workspace role", async () => {
    mocks.options.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          resumeSources: [{ id: "source-1", name: "实际业务中心" }],
          roles: [],
        }),
      ),
    );
    await mount(
      <SscResponsibilityEditorDialog open record={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    await pick("ssc-resumeSourceId", "实际业务中心");
    expect(document.body.textContent).toContain("待设置角色");
    expect(button("保存")?.disabled).toBe(true);
    await act(() => button("保存")?.click());
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("SSC responsibility grid", () => {
  it("shows the linked center's current name and actual workspace role label", async () => {
    mocks.list.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          page: 1,
          pageSize: 20,
          records: [{ ...record, resumeSourceId: "source-1", resumeSourceName: "中心新名称" }],
          total: 1,
          totalPages: 1,
        }),
      ),
    );
    const host = await mountGrid();
    await waitForUi(() => expect(host.textContent).toContain("中心新名称"));
    expect(host.textContent).toContain("已关联");
    expect(host.textContent).toContain("SSC角色");
    expect(host.textContent).not.toContain("未建中心");
  });

  it("keeps unmatched original names visible and marks missing role assignments", async () => {
    mocks.list.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          page: 1,
          pageSize: 20,
          records: [{ ...record, workspaceRole: null, workspaceRoleName: null }],
          total: 1,
          totalPages: 1,
        }),
      ),
    );
    const host = await mountGrid();
    await waitForUi(() => expect(host.textContent).toContain("未建中心"));
    expect(host.textContent).toContain("待关联");
    expect(host.textContent).toContain("待设置角色");
    expect(host.textContent).not.toContain("SSC角色");
  });

  it("shows missing SSC contact details as pending completion without changing the saved values", async () => {
    mocks.list.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          page: 1,
          pageSize: 20,
          records: [{ ...record, email: "", sscName: "", telegram: "" }],
          total: 1,
          totalPages: 1,
        }),
      ),
    );
    const host = await mountGrid();
    await waitForUi(() => expect(host.textContent).toContain("未建中心"));
    expect(host.textContent?.match(/待补充/g)).toHaveLength(3);
    await act(() => button("编辑")?.click());
    for (const id of ["ssc-sscName", "ssc-email", "ssc-telegram"]) {
      expect(document.querySelector<HTMLInputElement>(`#${id}`)?.value).toBe("");
    }
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("passes URL pagination, sorting and literal search to the workspace endpoint", async () => {
    const host = await mountGrid("?page=2&pageSize=20&search=%25_team&sortBy=email&sortOrder=desc");
    await waitForUi(() => expect(host.textContent).toContain("林风"));
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { slug: "work" },
        query: {
          page: "2",
          pageSize: "20",
          search: "%_team",
          sortBy: "email",
          sortOrder: "desc",
        },
      }),
      expect.anything(),
    );
    for (const value of ["需求负责人", "未建中心", "林风", "@ssc", "ssc@example.com", "备注内容"]) {
      expect(host.textContent).toContain(value);
    }
  });
  it("deletes only after confirmation and refreshes the list", async () => {
    const host = await mountGrid();
    await waitForUi(() => expect(host.textContent).toContain("林风"));
    await act(() => button("删除")?.click());
    expect(mocks.remove).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("删除 SSC 负责组织");
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (item) => item.textContent?.trim() === "删除",
    );
    await act(() => confirm?.click());
    await waitForUi(() => expect(mocks.list.mock.calls.length).toBeGreaterThan(1));
    expect(mocks.remove).toHaveBeenCalledWith({ param: { id: "ssc-1", slug: "work" } });
  });
});
