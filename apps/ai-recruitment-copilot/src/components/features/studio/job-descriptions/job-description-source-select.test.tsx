// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobDescriptionSourceSelect } from "./job-description-source-select";

const mocks = vi.hoisted(() => ({ canCreate: true, get: vi.fn() }));
vi.mock("@/hooks/use-has-permission", () => ({ useHasPermission: () => mocks.canCreate }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "alpha" }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: { api: { w: { ":slug": { studio: { "resume-sources": { $get: mocks.get } } } } } },
}));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    disabled,
  }: {
    options: { label: string; value: string }[];
    value: string | null;
    onChange: (value: string | null) => void;
    disabled: boolean;
  }) => (
    <select
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">请选择</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../resume-sources/resume-source-form-dialog", () => ({
  ResumeSourceFormDialog: ({
    open,
    onSaved,
    onOpenChange,
  }: {
    open: boolean;
    onSaved: (value: { name: string; id: string }) => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onSaved({ id: "source-new", name: "新来源" });
          onOpenChange(false);
        }}
      >
        保存来源
      </button>
    ) : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  mocks.canCreate = true;
  mocks.get.mockResolvedValue({ records: [{ id: "source-1", name: "已维护来源" }] });
});
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.replaceChildren();
  vi.clearAllMocks();
});
async function render(value: string | null = null, disabled = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <JobDescriptionSourceSelect
          id="source"
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await delay(10);
  });
  const select = host.querySelector("select");
  if (!select) {
    throw new Error("Missing source selector");
  }
  return { client, host, onChange, select };
}
function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
describe("job description source selection", () => {
  it("loads workspace sources and submits their names, with clearing supported", async () => {
    const { select, onChange } = await render();
    expect(mocks.get).toHaveBeenCalledWith({ param: { slug: "alpha" } });
    choose(select, "source-1");
    expect(onChange).toHaveBeenLastCalledWith("已维护来源", "source-1");
    choose(select, "");
    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });
  it("preserves a historical source absent from the source table", async () => {
    const { select, onChange } = await render("历史来源");
    expect(select.selectedOptions[0].textContent).toBe("历史来源");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("selects a newly saved source and refreshes the workspace source list", async () => {
    const { select, host, onChange, client } = await render();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    choose(select, "__create_source__");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      host.querySelector("button")?.click();
      await delay(10);
    });
    expect(onChange).toHaveBeenCalledWith("新来源", "source-new");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["resume-sources", "alpha"] });
  });
  it("hides creation without source permissions and disables read-only selection", async () => {
    mocks.canCreate = false;
    const { select } = await render("已维护来源", true);
    expect(select.disabled).toBe(true);
    expect(select.textContent).not.toContain("新建简历来源");
    expect(select.selectedOptions[0].textContent).toBe("已维护来源");
  });
});
