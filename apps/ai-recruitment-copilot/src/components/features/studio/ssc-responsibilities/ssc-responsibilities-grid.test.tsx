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
  sscName: "林风",
  telegram: "@ssc",
  updatedAt: "2026-10-17T00:00:00.000Z",
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

describe("SSC responsibility editor", () => {
  it("accepts unregistered SSC and unknown organization text with optional fields blank", async () => {
    const saved = vi.fn();
    await mount(
      <SscResponsibilityEditorDialog open record={null} onOpenChange={vi.fn()} onSaved={saved} />,
    );
    expect(button("保存")?.disabled).toBe(true);
    for (const label of ["需求对接负责人", "中心/部门", "SSC 花名", "SSC TG", "SSC 邮箱", "备注"]) {
      expect(document.body.textContent).toContain(label);
    }
    await fill("ssc-centerName", "  尚未创建的组织  ");
    await fill("ssc-sscName", "  新人SSC  ");
    await fill("ssc-email", "NEW@EXAMPLE.COM");
    expect(button("保存")?.disabled).toBe(false);
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        centerName: "尚未创建的组织",
        demandOwner: "",
        email: "new@example.com",
        notes: "",
        sscName: "新人SSC",
        telegram: "",
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
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(mocks.error).toHaveBeenCalledWith("该中心与邮箱已存在负责关系"));
    expect(mocks.patch).toHaveBeenCalledWith({
      json: {
        centerName: "未建中心",
        demandOwner: "需求负责人",
        email: "ssc@example.com",
        notes: "新备注",
        sscName: "林风",
        telegram: "@ssc",
      },
      param: { id: "ssc-1", slug: "work" },
    });
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("SSC responsibility grid", () => {
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
