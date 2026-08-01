// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ResumePoolListRecord } from "@arc/shared/resume-pool";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportResumePoolDialog } from "../resume-pool-dialogs";
import type * as ResumePoolPageModel from "../resume-pool-page-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const importResumePoolItemMock = vi.hoisted(() => vi.fn());
const listHiringUnitsMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ id, onChange }: { id?: string; onChange: (value: string) => void }) => (
    <button data-testid={id} onClick={() => onChange("hiring-unit-1")} type="button">
      选择用人组织
    </button>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceSlug: () => "test-workspace",
}));

vi.mock("@/lib/client/api", () => ({
  importResumePoolItem: importResumePoolItemMock,
  isApiError: () => false,
}));

vi.mock("@/components/features/studio/studio-person-detail-dialog", () => ({
  StudioPersonDetailDialog: ({ open, recordId }: { open: boolean; recordId: string | null }) =>
    open ? <div>招聘台详情 {recordId}</div> : null,
}));

vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "hiring-units": {
              selectable: { $get: listHiringUnitsMock },
            },
          },
        },
      },
    },
  },
}));

vi.mock("../resume-pool-page-model", async (importOriginal) => ({
  ...(await importOriginal<typeof ResumePoolPageModel>()),
  useJobDescriptions: () => ({ data: [] }),
}));

const importedItem = {
  candidateName: "测试候选人",
  id: "pool-item-1",
  importedRecords: [
    { importedAt: "2026-07-31T03:00:00.000Z", resumeRecordId: "resume-record-2" },
    { importedAt: "2026-07-30T03:00:00.000Z", resumeRecordId: "resume-record-1" },
  ],
  importedResumeRecordId: "resume-record-2",
  jobDescriptionId: null,
  scope: "public",
} as ResumePoolListRecord;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("ImportResumePoolDialog", () => {
  it("confirms and requests a new import for an imported resume", async () => {
    importResumePoolItemMock.mockResolvedValue({
      resumeRecordId: "resume-record-2",
      status: "imported",
    });
    listHiringUnitsMock.mockResolvedValue(
      Response.json({ records: [{ id: "hiring-unit-1", name: "研发一部" }] }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ImportResumePoolDialog item={importedItem} onImported={vi.fn()} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("已在招聘台，是否再次入库。");
    expect(document.body.textContent).toContain("已入库记录");
    const importedRecordButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="查看已入库记录 resume-record-2"]',
    );
    expect(importedRecordButton).toBeTruthy();
    expect(document.querySelector('[aria-label="查看已入库记录 resume-record-1"]')).toBeTruthy();
    await act(async () => {
      importedRecordButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("招聘台详情 resume-record-2");
    });

    const confirmButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("确认再次入库"),
    );
    expect(confirmButton).toBeTruthy();

    const hiringUnitButton = document.querySelector(
      '[data-testid="resume-pool-import-hiring-unit"]',
    );
    await act(async () => {
      hiringUnitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(importResumePoolItemMock).toHaveBeenCalledWith("test-workspace", "pool-item-1", {
      dedupPolicy: "force",
      hiringUnitId: "hiring-unit-1",
      jobDescriptionId: null,
      jobDescriptionMode: "none",
      recommendationText: "",
      reimport: true,
    });

    act(() => {
      root.unmount();
    });
  });
});
