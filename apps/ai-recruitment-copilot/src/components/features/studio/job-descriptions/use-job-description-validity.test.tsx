// @vitest-environment jsdom

import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionMenuItem } from "@/components/data-grid";
import { useJobDescriptionValidity } from "./use-job-description-validity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpcFetchMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client/api/rpc-fetch", () => ({ rpcFetch: rpcFetchMock }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": { studio: { "job-descriptions": { ":id": { validity: { $patch: patchMock } } } } },
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("job description validity actions", () => {
  it("uses edit permission and blocks reactivation of Google-deleted jobs", async () => {
    const onUpdated = vi.fn();
    let actions: ActionMenuItem<JobDescriptionListRecord>[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Probe({ canUpdate }: { canUpdate: boolean }) {
      actions = useJobDescriptionValidity(canUpdate, onUpdated, "work");
      return null;
    }
    const active = {
      googleSheetDeleted: false,
      id: "job-1",
      manuallyInactive: false,
    } as JobDescriptionListRecord;
    const inactive = { ...active, manuallyInactive: true };
    const deleted = { ...inactive, googleSheetDeleted: true };

    act(() => root.render(<Probe canUpdate={false} />));
    expect(actions.every((action) => !action.show?.(active))).toBe(true);
    act(() => root.render(<Probe canUpdate={true} />));
    expect(actions[0]?.show?.(active)).toBe(true);
    expect(actions[1]?.show?.(inactive)).toBe(true);
    expect(actions[1]?.disabled?.(deleted)).toBe(true);

    rpcFetchMock.mockResolvedValue({ manuallyInactive: true });
    await act(() => actions[0]?.onClick(active));
    expect(patchMock).toHaveBeenCalledWith({
      json: { manuallyInactive: true },
      param: { id: "job-1", slug: "work" },
    });
    expect(onUpdated).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
