// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchableMultiSelectProps } from "@/components/ui/searchable-multi-select";
import type { OdcAssignmentDraft } from "./odc-assignment-draft";
import { OdcAddDialog } from "./odc-add-dialog";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "alpha" }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: { ":slug": { studio: { "resume-sources": { ":id": { odc: { $post: mocks.post } } } } } },
    },
  },
}));
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: (request: unknown) => request }));
vi.mock("./use-odc-candidates", () => ({
  toOdcCandidateOption: (candidate: { memberId: string }, disabled: boolean) => ({
    disabled,
    label: candidate.memberId,
    value: candidate.memberId,
  }),
  useOdcCandidates: () => ({ data: ["a", "b", "existing"].map((memberId) => ({ memberId })) }),
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: ({ options, value, onChange, disabled }: SearchableMultiSelectProps) => (
    <select
      multiple
      value={value}
      disabled={disabled}
      onChange={(event) =>
        onChange(Array.from(event.target.selectedOptions, (option) => option.value))
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("./odc-assignment-scope-fields", () => ({
  OdcAssignmentScopeFields: ({
    assignments,
    onChange,
  }: {
    assignments: OdcAssignmentDraft[];
    onChange: (value: OdcAssignmentDraft[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(
          assignments.map((assignment) => ({
            ...assignment,
            jobSeries: "直属",
            serviceUnit: " 悦达 ",
          })),
        )
      }
    >
      设置范围
    </button>
  ),
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
function button(text: string) {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) {
    throw new Error(`Missing button: ${text}`);
  }
  return found;
}
describe("adding multiple ODC members", () => {
  it("preserves an edited scope when selecting more people and submits one batch", async () => {
    mocks.post.mockResolvedValue({ success: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <OdcAddDialog
            open
            assignedMemberIds={["existing"]}
            onSaved={onSaved}
            onOpenChange={onOpenChange}
            target={{ id: "source-a", name: "来源", odcMembers: [], rowType: "resumeSource" }}
          />
        </QueryClientProvider>,
      ),
    );
    const select = document.querySelector("select");
    if (!select) {
      throw new Error("Missing selector");
    }
    expect(button("添加").disabled).toBe(true);
    expect(select.options[2].disabled).toBe(true);
    act(() => {
      select.options[0].selected = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button("设置范围").click());
    act(() => {
      select.options[1].selected = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      button("添加").click();
      await delay(10);
    });
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith({
      json: {
        assignments: [
          { jobSeries: "直属", memberId: "a", serviceUnit: "悦达" },
          { jobSeries: null, memberId: "b", serviceUnit: null },
        ],
      },
      param: { id: "source-a", slug: "alpha" },
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(select.selectedOptions).toHaveLength(0);
  });
});
