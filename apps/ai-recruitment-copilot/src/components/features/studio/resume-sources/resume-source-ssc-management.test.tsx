// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  installNoopResizeObserver,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { ResumeSourceManagementPage } from "./resume-source-management-page";

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  candidates: vi.fn(),
  create: vi.fn(),
  error: vi.fn(),
  list: vi.fn(),
  options: vi.fn(),
  patch: vi.fn(),
  permissions: new Set<string>(),
  remove: vi.fn(),
  role: "admin",
  sources: vi.fn(),
}));
vi.mock("@/hooks/use-has-permission", () => ({
  useHasPermission: (resource: string, action: string) =>
    mocks.permissions.has(`${resource}:${action}`),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceMemberRole: () => mocks.role,
  useWorkspaceSlug: () => "work",
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "resume-sources": { $get: mocks.sources },
            "ssc-responsibilities": {
              $get: mocks.list,
              $post: mocks.create,
              ":id": { $delete: mocks.remove, $patch: mocks.patch },
              assign: { $post: mocks.assign },
              candidates: { $get: mocks.candidates },
              options: { $get: mocks.options },
            },
          },
        },
      },
    },
  },
}));
vi.mock("../odc-assignment-dialog", () => ({ OdcAssignmentDialog: () => null }));
vi.mock("../odc-management-modal", () => ({ OdcManagementModal: () => null }));
vi.mock("./resume-source-children-modal", () => ({ ResumeSourceChildrenModal: () => null }));
vi.mock("./resume-source-form-dialog", () => ({ ResumeSourceFormDialog: () => null }));

enableReactActEnvironment();
const sourceRows = [
  { id: "source-a", name: "研发中心" },
  { id: "source-b", name: "运营中心" },
].map((source) => ({
  ...source,
  createdAt: "2026-10-18T00:00:00.000Z",
  createdBy: null,
  departmentCount: 0,
  description: null,
  hiringUnitCount: 0,
  jobDescriptionCount: 0,
  odcMembers: [],
  updatedAt: "2026-10-18T00:00:00.000Z",
}));
const ledger = {
  centerName: "研发中心",
  createdAt: "2026-10-18T00:00:00.000Z",
  demandOwner: "负责人",
  departmentId: "department-b",
  departmentName: "创意部",
  email: "current@example.com",
  id: "entry-1",
  notes: "范围备注",
  resumeSourceId: "source-a",
  resumeSourceName: "研发中心",
  serviceUnit: "智能增长事业部",
  sscName: "当前SSC",
  telegram: "@current",
  updatedAt: "2026-10-18T00:00:00.000Z",
  workspaceRole: "ssc-01",
  workspaceRoleName: "SSC审核角色",
};
const candidates = [
  {
    assigned: false,
    email: "member@example.com",
    id: "member-one",
    registered: true,
    sscName: "已注册甲",
  },
  {
    assigned: false,
    email: "pending@example.com",
    id: "preentry-two",
    registered: false,
    sscName: "预录乙",
  },
  {
    assigned: true,
    email: "assigned@example.com",
    id: "already-three",
    registered: true,
    sscName: "已配置丙",
  },
].map((candidate) => ({
  ...candidate,
  telegram: "",
  workspaceRole: "ssc-01",
  workspaceRoleName: "SSC审核角色",
}));
let mounted: Awaited<ReturnType<typeof renderInAct>> | undefined;
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.permissions = new Set(["page:hiringUnits", "hiringUnit:read", "page:sscResponsibilities"]);
  installNoopResizeObserver();
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })),
  );
  mocks.sources.mockImplementation(() => Promise.resolve(Response.json({ records: sourceRows })));
  mocks.list.mockImplementation(
    ({ query }: { query: { page: string; pageSize: string; resumeSourceId: string } }) =>
      Promise.resolve(
        Response.json({
          page: Number(query.page),
          pageSize: Number(query.pageSize),
          records: [{ ...ledger, resumeSourceId: query.resumeSourceId }],
          total: 1,
          totalPages: 1,
        }),
      ),
  );
  mocks.candidates.mockImplementation(() => Promise.resolve(Response.json({ candidates })));
  mocks.options.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        departments: [
          { hiringUnitName: "事业部甲", id: "department-a", name: "创意部" },
          { hiringUnitName: "事业部乙", id: "department-b", name: "创意部" },
        ],
        resumeSources: sourceRows.map(({ id, name }) => ({ id, name })),
        roles: [{ label: "SSC审核角色", value: "ssc-01" }],
        serviceUnits: ["智能增长事业部"],
      }),
    ),
  );
  mocks.assign.mockImplementation(() =>
    Promise.resolve(Response.json({ addedCount: 2, success: true })),
  );
  mocks.create.mockImplementation(() =>
    Promise.resolve(Response.json({ id: "new-entry" }, { status: 201 })),
  );
  mocks.patch.mockImplementation(() => Promise.resolve(Response.json({ id: ledger.id })));
  mocks.remove.mockImplementation(() => Promise.resolve(Response.json({ success: true })));
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});
afterEach(async () => {
  if (mounted) {
    await unmountInAct(mounted.root);
  }
  mounted = undefined;
  client.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function page() {
  return (
    <QueryClientProvider client={client}>
      <ResumeSourceManagementPage />
    </QueryClientProvider>
  );
}
async function mountPage() {
  mounted = await renderInAct(page());
  await waitForUi(() => expect(document.body.textContent).toContain("研发中心"));
}
function button(label: string, scope: ParentNode = document.body) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found;
}
async function manage(name = "研发中心") {
  const row = [...document.querySelectorAll("tr")].find((item) => item.textContent?.includes(name));
  expect(row).toBeDefined();
  await act(() => button("管理 SSC", row)?.click());
  await waitForUi(() => expect(document.body.textContent).toContain("当前SSC"));
}
async function pickCandidate(name: string) {
  const input = document.querySelector<HTMLInputElement>("#ssc-management-add-members");
  expect(input).not.toBeNull();
  await act(() => {
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  let option: HTMLElement | undefined;
  await waitForUi(() => {
    option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      item.textContent?.includes(name),
    );
    expect(option).toBeDefined();
  });
  await act(() => option?.click());
  return option;
}
async function fill(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  expect(input).not.toBeNull();
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pickDepartment() {
  await waitForUi(() =>
    expect(
      document.querySelector<HTMLInputElement>("#ssc-management-add-departmentId")?.disabled,
    ).toBe(false),
  );
  const input = document.querySelector<HTMLInputElement>("#ssc-management-add-departmentId");
  await act(() => {
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  let option: HTMLElement | undefined;
  await waitForUi(() => {
    option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      item.textContent?.includes("事业部乙"),
    );
    expect(option).toBeDefined();
  });
  await act(() => option?.click());
}

describe("source SSC management", () => {
  it("shows service unit and department in the source responsibility list", async () => {
    await mountPage();
    await manage();
    expect(document.body.textContent).toContain("智能增长事业部");
    expect(document.body.textContent).toContain("创意部");
  });

  it("queries and assigns using the selected scope and clears candidates when the scope changes", async () => {
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await waitForUi(() =>
      expect(document.querySelector("#ssc-management-add-members")?.matches(":disabled")).toBe(
        false,
      ),
    );
    await pickCandidate("已注册甲");
    await fill("ssc-management-add-serviceUnit", "智能增长事业部");
    await waitForUi(() => expect(button("添加")?.disabled).toBe(true));
    expect(document.querySelector('[aria-label="移除 已注册甲"]')).toBeNull();
    await pickDepartment();
    await waitForUi(() =>
      expect(mocks.candidates).toHaveBeenLastCalledWith({
        param: { slug: "work" },
        query: {
          departmentId: "department-b",
          resumeSourceId: "source-a",
          serviceUnit: "智能增长事业部",
        },
      }),
    );
    await waitForUi(() =>
      expect(document.querySelector("#ssc-management-add-members")?.matches(":disabled")).toBe(
        false,
      ),
    );
    await pickCandidate("已注册甲");
    await act(() => button("添加")?.click());
    await waitForUi(() => expect(mocks.assign).toHaveBeenCalledOnce());
    expect(mocks.assign).toHaveBeenCalledWith({
      json: {
        candidateIds: ["member-one"],
        departmentId: "department-b",
        resumeSourceId: "source-a",
        serviceUnit: "智能增长事业部",
      },
      param: { slug: "work" },
    });
  });

  it("retains the selected scope when switching from adding an SSC to preregistering one", async () => {
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await fill("ssc-management-add-serviceUnit", "智能增长事业部");
    await pickDepartment();
    await act(() => button("预录新 SSC")?.click());
    await waitForUi(() =>
      expect(document.querySelector<HTMLInputElement>("#ssc-departmentId")?.value).toBe("创意部"),
    );
    expect(document.querySelector<HTMLInputElement>("#ssc-serviceUnit")?.value).toBe(
      "智能增长事业部",
    );
    await fill("ssc-email", "new@example.com");
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          departmentId: "department-b",
          resumeSourceId: "source-a",
          serviceUnit: "智能增长事业部",
        }),
      }),
    );
  });
  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["member", true, false],
    ["custom-ssc", true, false],
    ["admin", false, false],
  ] as const)(
    "gates the source button for %s with SSC page permission %s",
    async (role, permission, visible) => {
      mocks.role = role;
      if (!permission) {
        mocks.permissions.delete("page:sscResponsibilities");
      }
      await mountPage();
      expect(
        [...document.querySelectorAll("button")].some(
          (item) => item.textContent?.trim() === "管理 SSC",
        ),
      ).toBe(visible);
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it("loads only the chosen source and shares the global SSC cache prefix", async () => {
    await mountPage();
    await manage();
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { slug: "work" },
        query: expect.objectContaining({ page: "1", pageSize: "10", resumeSourceId: "source-a" }),
      }),
    );
    expect(
      client.getQueryData(["studio-ssc-responsibilities", "work", "source", "source-a", 1, 10]),
    ).toMatchObject({ records: [{ id: "entry-1" }] });
  });

  it("adds registered and preregistered SSCs in one request and disables assigned candidates", async () => {
    client.setQueryData(["studio-ssc-responsibilities", "work", "global-fixture"], { records: [] });
    client.setQueryData(["workspace-members", "work"], { records: [] });
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await waitForUi(() =>
      expect(document.querySelector("#ssc-management-add-members")?.matches(":disabled")).toBe(
        false,
      ),
    );
    const assigned = await pickCandidate("已配置丙");
    expect(assigned?.getAttribute("aria-disabled")).toBe("true");
    expect(button("添加")?.disabled).toBe(true);
    await pickCandidate("已注册甲");
    await pickCandidate("预录乙");
    await act(() => button("添加")?.click());
    await waitForUi(() => expect(mocks.assign).toHaveBeenCalledOnce());
    expect(mocks.assign).toHaveBeenCalledWith({
      json: {
        candidateIds: ["member-one", "preentry-two"],
        departmentId: null,
        resumeSourceId: "source-a",
        serviceUnit: null,
      },
      param: { slug: "work" },
    });
    await waitForUi(() => expect(mocks.list.mock.calls.length).toBeGreaterThan(1));
    expect(
      client.getQueryState(["studio-ssc-responsibilities", "work", "global-fixture"])
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["workspace-members", "work"])?.isInvalidated).toBe(true);
  });

  it("preregisters an unknown email through the shared editor with the current source fixed", async () => {
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await act(() => button("预录新 SSC")?.click());
    const source = document.querySelector<HTMLInputElement>("#ssc-fixed-source");
    expect(source?.readOnly).toBe(true);
    expect(source?.value).toBe("研发中心");
    expect(document.querySelector("#ssc-resumeSourceId")).toBeNull();
    await fill("ssc-email", " NEW@EXAMPLE.COM ");
    await waitForUi(() => expect(button("保存")?.disabled).toBe(false));
    await act(() => button("保存")?.click());
    await waitForUi(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      json: {
        centerName: "研发中心",
        demandOwner: "",
        departmentId: null,
        email: "new@example.com",
        notes: "",
        resumeSourceId: "source-a",
        serviceUnit: null,
        sscName: "",
        telegram: "",
        workspaceRole: "ssc-01",
      },
      param: { slug: "work" },
    });
  });

  it.each(["role", "page"])(
    "hides the modal and stops SSC fetching when the %s gate is revoked",
    async (gate) => {
      await mountPage();
      await manage();
      const previousCalls = mocks.list.mock.calls.length;
      if (gate === "role") {
        mocks.role = "member";
      } else {
        mocks.permissions.delete("page:sscResponsibilities");
      }
      await act(() => mounted?.root.render(page()));
      await client.invalidateQueries({ queryKey: ["studio-ssc-responsibilities", "work"] });
      await waitForUi(() => expect(document.body.textContent).not.toContain("当前SSC"));
      expect(
        [...document.querySelectorAll("button")].some(
          (item) => item.textContent?.trim() === "管理 SSC",
        ),
      ).toBe(false);
      expect(mocks.list).toHaveBeenCalledTimes(previousCalls);
    },
  );

  it("retries source-list failures and then renders the ledger", async () => {
    mocks.list.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ error: "暂时不可用" }, { status: 500 })),
    );
    await mountPage();
    const row = [...document.querySelectorAll("tr")].find((item) =>
      item.textContent?.includes("研发中心"),
    );
    await act(() => button("管理 SSC", row)?.click());
    await waitForUi(() => expect(document.body.textContent).toContain("暂时不可用"));
    await act(() => button("重试")?.click());
    await waitForUi(() => expect(document.body.textContent).toContain("当前SSC"));
  });

  it("retries candidate failures without losing the selected source", async () => {
    mocks.candidates.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ error: "候选加载不可用" }, { status: 500 })),
    );
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await waitForUi(() => expect(document.body.textContent).toContain("候选加载不可用"));
    await act(() => button("重新加载")?.click());
    await waitForUi(() =>
      expect(document.querySelector("#ssc-management-add-members")?.matches(":disabled")).toBe(
        false,
      ),
    );
    expect(mocks.candidates).toHaveBeenLastCalledWith({
      param: { slug: "work" },
      query: { departmentId: "", resumeSourceId: "source-a", serviceUnit: "" },
    });
  });

  it("resets pagination and pending selections when another source is opened", async () => {
    mocks.list.mockImplementation(
      ({ query }: { query: { page: string; pageSize: string; resumeSourceId: string } }) =>
        Promise.resolve(
          Response.json({
            page: Number(query.page),
            pageSize: Number(query.pageSize),
            records: [ledger],
            total: 11,
            totalPages: 2,
          }),
        ),
    );
    await mountPage();
    await manage();
    await act(() => document.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.click());
    await waitForUi(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ page: "2" }) }),
      ),
    );
    await act(() => button("添加 SSC")?.click());
    await waitForUi(() =>
      expect(document.querySelector("#ssc-management-add-members")?.matches(":disabled")).toBe(
        false,
      ),
    );
    await pickCandidate("预录乙");
    await act(() => button("取消")?.click());
    await act(() => button("关闭")?.click());
    await manage("运营中心");
    await waitForUi(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ page: "1", resumeSourceId: "source-b" }),
        }),
      ),
    );
    await act(() => button("添加 SSC")?.click());
    await waitForUi(() =>
      expect(mocks.candidates).toHaveBeenLastCalledWith({
        param: { slug: "work" },
        query: { departmentId: "", resumeSourceId: "source-b", serviceUnit: "" },
      }),
    );
    expect(button("添加")?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="移除 预录乙"]')).toBeNull();
  });

  it("keeps selected candidates and shows assignment errors without closing", async () => {
    mocks.assign.mockImplementation(() =>
      Promise.resolve(Response.json({ error: "SSC 角色已变化，请刷新" }, { status: 400 })),
    );
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await waitForUi(() =>
      expect(document.querySelector("#ssc-management-add-members")?.matches(":disabled")).toBe(
        false,
      ),
    );
    await pickCandidate("预录乙");
    await act(() => button("添加")?.click());
    await waitForUi(() => expect(mocks.error).toHaveBeenCalledWith("SSC 角色已变化，请刷新"));
    expect(button("添加")?.disabled).toBe(false);
    expect(document.querySelector('[aria-label="移除 预录乙"]')).not.toBeNull();
  });

  it("explains when there are no eligible SSC roles and keeps preregistration saving disabled", async () => {
    mocks.candidates.mockImplementation(() => Promise.resolve(Response.json({ candidates: [] })));
    mocks.options.mockImplementation(() =>
      Promise.resolve(Response.json({ resumeSources: sourceRows, roles: [] })),
    );
    await mountPage();
    await manage();
    await act(() => button("添加 SSC")?.click());
    await act(() => button("预录新 SSC")?.click());
    await waitForUi(() => expect(document.body.textContent).toContain("当前工作区暂无 SSC 角色"));
    expect(button("保存")?.disabled).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
