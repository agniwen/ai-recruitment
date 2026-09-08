// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchableMultiSelectProps } from "@/components/ui/searchable-multi-select";
import { PreRegistrationEditorDialog } from "./studio-pre-registrations-grid";

const mocks = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn(), sources: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "alpha" }));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "pre-registrations": {
              $post: mocks.post,
              ":id": { $patch: mocks.patch },
              "resume-source-options": { $get: mocks.sources },
            },
          },
        },
      },
    },
  },
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: ({
    id,
    options,
    value,
    onChange,
    disabled,
  }: SearchableMultiSelectProps) => (
    <select
      id={id}
      multiple
      disabled={disabled}
      value={value}
      onChange={(event) =>
        onChange(Array.from(event.target.selectedOptions, (option) => option.value))
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const record: NonNullable<ComponentProps<typeof PreRegistrationEditorDialog>["record"]> = {
  createdAt: "2026-09-08T00:00:00Z",
  directManagerEmail: null,
  directManagerName: null,
  displayName: "ODC",
  email: "odc@example.com",
  id: "entry",
  odcAssignments: [{ jobSeries: "直属", resumeSourceId: "source-a", serviceUnit: "悦达" }],
  recruitingGroupNames: [],
  recruitingRole: "hr",
  registeredUserId: null,
  telegram: "@odc",
  updatedAt: "2026-09-08T00:00:00Z",
  workspaceRole: "custom-odc",
  workspaceSlug: "alpha",
};
async function render(entry: typeof record | null) {
  mocks.sources.mockResolvedValue({
    records: [
      { id: "source-a", name: "来源 A" },
      { id: "source-b", name: "来源 B" },
    ],
  });
  mocks.patch.mockResolvedValue({ id: "entry" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PreRegistrationEditorDialog
          open
          record={entry}
          managerOptions={[]}
          roleOptions={[
            { isOdc: false, label: "成员", value: "member" },
            { isOdc: true, label: "ODC", value: "custom-odc" },
          ]}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await delay(10);
  });
}
function roleSelect() {
  const found = [...document.querySelectorAll("select")].find((select) =>
    [...select.options].some((option) => option.value === "custom-odc"),
  );
  if (!found) {
    throw new Error("Missing role select");
  }
  return found;
}
async function chooseRole(value: string) {
  act(() => {
    const select = roleSelect();
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await delay(10);
  });
}
async function submit() {
  await act(async () => {
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await delay(10);
  });
}
describe("pre-registration ODC fields", () => {
  it("shows source options only when the selected role is marked ODC", async () => {
    await render(null);
    expect(document.querySelector("select[multiple]")).toBeNull();
    expect(mocks.sources).not.toHaveBeenCalled();
    await chooseRole("custom-odc");
    expect(document.querySelector("select[multiple]")).not.toBeNull();
    expect(mocks.sources).toHaveBeenCalledWith({ param: { slug: "alpha" } });
    await chooseRole("member");
    expect(document.querySelector("select[multiple]")).toBeNull();
  });
  it("restores existing scopes and retains them when adding another source", async () => {
    await render(record);
    const select = document.querySelector<HTMLSelectElement>("select[multiple]");
    if (!select) {
      throw new Error("Missing source selector");
    }
    expect(select.selectedOptions[0].value).toBe("source-a");
    expect(
      document.querySelector<HTMLInputElement>("#pre-registration-odc-source-a-unit")?.value,
    ).toBe("悦达");
    act(() => {
      select.options[1].selected = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit();
    expect(mocks.patch).toHaveBeenCalledWith({
      json: expect.objectContaining({
        odcAssignments: [
          record.odcAssignments[0],
          { jobSeries: null, resumeSourceId: "source-b", serviceUnit: null },
        ],
      }),
      param: { id: "entry", slug: "alpha" },
    });
  });
  it("clears source configurations when changing to a non-ODC role", async () => {
    await render(record);
    await chooseRole("member");
    await submit();
    expect(mocks.patch).toHaveBeenCalledWith({
      json: expect.objectContaining({ odcAssignments: [], workspaceRole: "member" }),
      param: { id: "entry", slug: "alpha" },
    });
  });
});
