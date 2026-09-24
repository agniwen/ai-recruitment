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
const jobDescriptionsMock = vi.hoisted(() => [
  {
    departmentName: "平台研发",
    hiringUnitName: "研发中心",
    id: "job-description-1",
    jobSeries: "技术",
    name: "前端工程师",
    resumeContact: "招聘 BP",
    serviceUnit: "产品技术部",
  },
]);

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ id, onChange }: { id?: string; onChange: (value: string) => void }) => (
    <button data-testid={id} onClick={() => onChange("hiring-unit-1")} type="button">
      选择用人组织
    </button>
  ),
}));

vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: ({
    id,
    onChange,
    options,
  }: {
    id?: string;
    onChange: (value: string[]) => void;
    options: { value: string }[];
  }) => (
    <button
      data-testid={id}
      onClick={() => onChange(options.map((option) => option.value))}
      type="button"
    >
      选择选项
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
  batchImportResumePoolItem: importResumePoolItemMock,
  fetchResumePoolImportOptions: () =>
    Promise.resolve({
      departments: [],
      hiringUnits: [{ id: "hiring-unit-1", name: "研发一部" }],
      jobDescriptions: jobDescriptionsMock,
    }),
  isApiError: () => false,
}));

vi.mock("@/components/features/studio/studio-person-detail-dialog", () => ({
  StudioPersonDetailDialog: ({ open, recordId }: { open: boolean; recordId: string | null }) =>
    open ? <div>候选人管理详情 {recordId}</div> : null,
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
  useJobDescriptions: () => ({ data: jobDescriptionsMock }),
}));

const importedItem = {
  candidateName: "测试候选人",
  id: "pool-item-1",
  importedRecords: [
    {
      creatorImage: "https://example.com/creator-2.png",
      creatorName: "招聘管理员",
      importedAt: "2026-07-31T03:00:00.000Z",
      resumeRecordId: "resume-record-2",
    },
    {
      creatorImage: null,
      creatorName: "人事专员",
      importedAt: "2026-07-30T03:00:00.000Z",
      resumeRecordId: "resume-record-1",
    },
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
  it("selects multiple job names and imports only checked destinations", async () => {
    importResumePoolItemMock.mockResolvedValue({ records: [], status: "imported" });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(["resume-pool", "test-workspace", "import-options"], {
      departments: [],
      hiringUnits: [{ id: "hiring-unit-1", name: "研发一部" }],
      jobDescriptions: [
        {
          ...jobDescriptionsMock[0],
          departmentId: "dept-1",
          hiringUnitId: "hiring-unit-1",
        },
        {
          ...jobDescriptionsMock[0],
          departmentId: "dept-2",
          hiringUnitId: "hiring-unit-1",
          id: "job-description-2",
          name: "后端工程师",
        },
      ],
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ImportResumePoolDialog
            item={{ ...importedItem, importedResumeRecordId: null }}
            onImported={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      [...document.querySelectorAll("label")]
        .find((label) => label.textContent?.trim() === "绑定岗位")
        ?.click();
      await Promise.resolve();
    });
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="candidate-import-job"]')?.click(),
    );
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="resume-pool-import-hiring-unit"]')
        ?.click(),
    );
    const selected = document.querySelector<HTMLElement>(
      '[data-destination-id="job-description-2"] [role="checkbox"]',
    );
    expect(document.querySelectorAll("[data-destination-id]")).toHaveLength(2);
    expect(selected?.getAttribute("aria-checked")).toBe("true");
    act(() => selected?.click());
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("确认入库"),
    );
    expect(confirm?.textContent).toContain("1 条记录");
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    expect(importResumePoolItemMock.mock.lastCall?.[2].destinations).toEqual([
      {
        departmentId: "dept-1",
        hiringUnitId: "hiring-unit-1",
        jobDescriptionId: "job-description-1",
        serviceUnit: "产品技术部",
      },
    ]);
    act(() => root.unmount());
  });

  it("prefills source job details when the modal opens", async () => {
    listHiringUnitsMock.mockResolvedValue(Response.json({ records: [] }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    queryClient.setQueryData(["resume-pool", "test-workspace", "import-options"], {
      departments: [],
      hiringUnits: [{ id: "hiring-unit-1", name: "研发一部" }],
      jobDescriptions: jobDescriptionsMock,
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ImportResumePoolDialog
            item={{
              ...importedItem,
              jobDescriptionId: "job-description-1",
              scope: "private",
            }}
            onImported={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    await vi.waitFor(async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        document.querySelector<HTMLTextAreaElement>("#resume-pool-import-recommendation")?.value,
      ).toContain("应聘岗位：前端工程师");
    });
    const recommendationInput = document.querySelector<HTMLTextAreaElement>(
      "#resume-pool-import-recommendation",
    );
    expect(recommendationInput?.value).toContain("应聘岗位：前端工程师");
    expect(recommendationInput?.value).toContain(
      "推荐编制组织/序列/服务单位：研发中心/技术/产品技术部",
    );
    expect(recommendationInput?.value).toContain("简历对接BP：招聘 BP");

    act(() => {
      root.unmount();
    });
  });

  it("confirms and requests a new import for an imported resume", async () => {
    importResumePoolItemMock.mockResolvedValue({
      records: [{ jobDescriptionId: null, resumeRecordId: "resume-record-2" }],
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

    queryClient.setQueryData(["resume-pool", "test-workspace", "import-options"], {
      departments: [],
      hiringUnits: [{ id: "hiring-unit-1", name: "研发一部" }],
      jobDescriptions: jobDescriptionsMock,
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ImportResumePoolDialog item={importedItem} onImported={vi.fn()} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("已在候选人管理，是否再次入库。");
    expect(document.body.textContent).toContain("已入库记录");
    expect(document.body.textContent).not.toContain("插入模版");
    const recommendationInput = document.querySelector<HTMLTextAreaElement>(
      "#resume-pool-import-recommendation",
    );
    expect(recommendationInput?.value).toContain("推荐简历");
    expect(recommendationInput?.value).toContain("候选人姓名：测试候选人");
    await act(async () => {
      if (recommendationInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(recommendationInput, "自定义推荐理由");
        recommendationInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await Promise.resolve();
    });
    queryClient.setQueryData(["resume-pool", "test-workspace", "import-options"], {
      departments: [],
      hiringUnits: [{ id: "hiring-unit-1", name: "研发一部" }],
      jobDescriptions: jobDescriptionsMock,
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ImportResumePoolDialog
            item={{ ...importedItem }}
            onImported={vi.fn()}
            onOpenChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    expect(recommendationInput?.value).toBe("自定义推荐理由");
    const importedRecordButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="查看已入库记录 resume-record-2"]',
    );
    expect(importedRecordButton).toBeTruthy();
    const creatorAvatar = importedRecordButton?.querySelector<HTMLElement>('[data-slot="avatar"]');
    expect(document.querySelector('[aria-label="查看已入库记录 resume-record-1"]')).toBeTruthy();
    expect(document.body.textContent).toContain("创建人 招聘管理员");
    expect(document.body.textContent).toContain("创建人 人事专员");
    expect(creatorAvatar?.dataset.size).toBe("sm");
    await act(async () => {
      importedRecordButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("候选人管理详情 resume-record-2");
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
      destinations: [
        {
          departmentId: null,
          hiringUnitId: "hiring-unit-1",
          jobDescriptionId: null,
          serviceUnit: null,
        },
      ],
      jobDescriptionMode: "none",
      recommendationText: "自定义推荐理由",
      requestId: expect.any(String),
    });

    act(() => {
      root.unmount();
    });
  });
});
