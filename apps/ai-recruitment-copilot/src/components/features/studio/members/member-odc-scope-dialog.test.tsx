// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberOdcScopeDialog } from "./member-odc-scope-dialog";

const mocks = vi.hoisted(() => ({ close: vi.fn(), error: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "alpha" }));
vi.mock("@/lib/client/api", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            workspace: {
              members: {
                ":memberId": { "odc-scope": { $put: mocks.put } },
                "odc-scopes": { $get: mocks.get },
              },
            },
          },
        },
      },
    },
  },
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value: string;
    disabled: boolean;
    onValueChange: (value: string) => void;
  }) => (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectGroup: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: () => <div data-testid="source-selection" />,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
const assignment = { jobSeries: "直属", resumeSourceId: "a", serviceUnit: "悦达" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    records: [
      {
        email: "odc@example.com",
        isOdc: true,
        memberId: "m",
        odcAssignments: [assignment],
        odcScopeMode: "selected",
      },
    ],
    sources: [{ id: "a", name: "来源 A" }],
  });
  mocks.put.mockResolvedValue({ success: true });
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemberOdcScopeDialog memberId="m" name="张三" onClose={mocks.close} />
      </QueryClientProvider>,
    );
    await delay(20);
  });
  await act(async () => {
    await delay(10);
  });
  return invalidate;
}
function choose(value: string) {
  const select = [...document.querySelectorAll("select")].find((element) =>
    [...element.options].some((option) => option.value === "all"),
  );
  if (!select) {
    throw new Error("Scope selector missing");
  }
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function save() {
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")
      ?.click();
    await delay(20);
  });
}

describe("member ODC scope dialog", () => {
  it("saves all scope for this member and refreshes both management views", async () => {
    const invalidate = await render();
    choose("all");
    expect(document.querySelector('[data-testid="source-selection"]')).toBeNull();
    await save();
    expect(mocks.put).toHaveBeenCalledWith({
      json: { odcAssignments: [assignment], odcScopeMode: "all" },
      param: { memberId: "m", slug: "alpha" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["member-odc-scopes", "alpha"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["odc-management", "alpha"] });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("restores selected constraints after toggling all without discarding the draft", async () => {
    await render();
    choose("all");
    choose("selected");
    expect(document.querySelector<HTMLInputElement>('[id$="-a-unit"]')?.value).toBe("悦达");
    await save();
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ json: { odcAssignments: [assignment], odcScopeMode: "selected" } }),
    );
  });
  it("keeps the editor open on a server error", async () => {
    await render();
    mocks.put.mockRejectedValue(new Error("该成员角色未标记为 ODC。"));
    choose("all");
    await save();
    expect(mocks.error).toHaveBeenCalledWith("该成员角色未标记为 ODC。");
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("does not allow a failed scope load to be saved", async () => {
    mocks.get.mockRejectedValue(new Error("offline"));
    await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "加载 ODC 负责范围失败",
    );
    await save();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
