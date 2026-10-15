// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SmartResumeTaskDetail,
  smartResumeTaskDraftSchema,
} from "@arc/shared/smart-resume-upload";
import type { PortfolioLinkInput, ResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import type { z } from "zod";
import { SmartResumeTaskDialog } from "./smart-resume-task-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  retry: vi.fn(),
  save: vi.fn(),
  submit: vi.fn(),
  uploadPortfolio: vi.fn(),
}));
vi.mock("@/lib/client/api/endpoints/bulk-resume-upload", () => ({
  uploadPortfolioForBulk: mocks.uploadPortfolio,
}));
vi.mock("@/components/features/resume/resume-document-preview-modal", () => ({
  ResumeDocumentPreviewModal: ({ url, fileName }: { url: string | null; fileName: string }) =>
    url ? (
      <dialog open aria-label="简历预览" data-url={url}>
        {fileName}
      </dialog>
    ) : null,
}));
vi.mock("./portfolio-add-menu", () => ({
  PortfolioAddMenu: ({
    disabled,
    onFiles,
    onLinks,
  }: {
    disabled: boolean;
    onFiles: (files: File[]) => void;
    onLinks: (links: PortfolioLinkInput[]) => Promise<void>;
  }) => (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onFiles([new File(["portfolio"], "作品.pdf", { type: "application/pdf" })])}
      >
        添加测试作品文件
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onLinks([{ name: "个人网站", url: "https://example.com/portfolio" }])}
      >
        添加测试作品链接
      </button>
    </>
  ),
}));
vi.mock("@/lib/client/api/endpoints/smart-resume-upload", () => ({
  getSmartResumeTask: mocks.get,
  retrySmartResumeTask: mocks.retry,
  saveSmartResumeTaskDraft: mocks.save,
  submitSmartResumeTask: mocks.submit,
}));
vi.mock("./resume-recruitment-source-fields", () => ({
  ResumeRecruitmentSourceFields: ({
    source,
    detail,
    disabled,
    onSourceChange,
    onDetailChange,
  }: {
    source: ResumeRecruitmentSource | "";
    detail: string;
    disabled: boolean;
    onSourceChange: (value: ResumeRecruitmentSource) => void;
    onDetailChange: (value: string) => void;
  }) => (
    <>
      <select
        aria-label="选择简历来源"
        value={source}
        disabled={disabled}
        onChange={(event) => {
          onSourceChange(event.target.value as ResumeRecruitmentSource);
          onDetailChange("");
        }}
      >
        <option value="">请选择来源</option>
        <option value="boss">Boss直聘</option>
        <option value="referral">内推</option>
        <option value="other">其他</option>
      </select>
      {source === "referral" || source === "other" ? (
        <input
          aria-label="来源详情"
          value={detail}
          disabled={disabled}
          onChange={(event) => onDetailChange(event.target.value)}
        />
      ) : null}
    </>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    children,
    footer,
    title,
  }: {
    children: ReactNode;
    footer: ReactNode;
    title: string;
  }) => (
    <dialog open aria-label={title}>
      {children}
      {footer}
    </dialog>
  ),
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: ({
    id,
    value,
    onChange,
    options,
    disabled,
  }: {
    id: string;
    value: string[];
    onChange: (value: string[]) => void;
    options: { value: string; label: string }[];
    disabled: boolean;
  }) => (
    <select
      id={id}
      multiple
      value={value}
      disabled={disabled}
      onChange={(event) =>
        onChange([...event.target.selectedOptions].map((option) => option.value))
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

let backend: SmartResumeTaskDetail;
let root: ReturnType<typeof createRoot> | null = null;
let client: QueryClient | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  backend = {
    jobs: ["job-a", "job-b"].map((id) => ({
      departmentName: "研发",
      hiringUnitId: "unit",
      hiringUnitName: "用人组织",
      id,
      name: id,
      resumeSourceName: "中心 A",
    })),
    task: {
      createdAt: "2026-10-15T00:00:00Z",
      id: "task",
      items: [
        {
          candidateName: "测试候选人",
          createdRecordIds: [],
          error: null,
          fileName: "test.pdf",
          id: "item",
          portfolioAttachments: [],
          result: null,
          selectedJobIds: ["job-a"],
          skipped: false,
          status: "ready",
        },
      ],
      recruitmentSource: "boss",
      recruitmentSourceDetail: null,
      submittedAt: null,
    },
  };
  mocks.get.mockImplementation(() => Promise.resolve(structuredClone(backend)));
  mocks.save.mockImplementation((_slug, _id, draft: z.infer<typeof smartResumeTaskDraftSchema>) => {
    for (const itemDraft of draft.items ?? []) {
      const item = backend.task.items.find((stored) => stored.id === itemDraft.itemId);
      if (!item) {
        throw new Error("Unknown item");
      }
      if (itemDraft.jobDescriptionIds !== undefined) {
        item.selectedJobIds = itemDraft.jobDescriptionIds;
      }
      if (itemDraft.skipped !== undefined) {
        item.skipped = itemDraft.skipped;
      }
      if (itemDraft.portfolioAttachments !== undefined) {
        item.portfolioAttachments = structuredClone(itemDraft.portfolioAttachments);
      }
    }
    if (draft.recruitmentSource !== undefined) {
      backend.task.recruitmentSource = draft.recruitmentSource;
    }
    if (draft.recruitmentSourceDetail !== undefined) {
      backend.task.recruitmentSourceDetail = draft.recruitmentSourceDetail;
    }
    return Promise.resolve({ saved: true });
  });
  mocks.submit.mockResolvedValue({ recordIds: ["candidate"] });
  mocks.uploadPortfolio.mockResolvedValue({
    id: "portfolio-id",
    mimeType: "application/pdf",
    name: "作品.pdf",
    size: 9,
  });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = null;
  client?.clear();
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await delay(15);
  });
}
async function render(onClose = vi.fn(), onSubmitted = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client = queryClient;
  await act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <SmartResumeTaskDialog slug="work" id="task" onClose={onClose} onSubmitted={onSubmitted} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { onClose, onSubmitted };
}
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((element) => element.textContent === text);
const sourceSelect = () =>
  document.querySelector<HTMLSelectElement>('select[aria-label="选择简历来源"]');

async function changeSource(value: string) {
  await act(() => {
    const select = sourceSelect();
    if (!select) {
      throw new Error("Missing source selector");
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function changeSourceDetail(value: string) {
  await act(() => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="来源详情"]');
    if (!input) {
      throw new Error("Missing source detail");
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("smart task continuation", () => {
  it("selects only accessible recommended jobs and retains manual destinations when toggling all", async () => {
    backend.jobs.push({ ...backend.jobs[0], id: "manual-job", name: "手动岗位" });
    backend.task.items[0].selectedJobIds = ["manual-job"];
    backend.task.items[0].result = {
      eligibleCount: 4,
      model: "rerank",
      recommendations: ["job-a", "job-b", "foreign-job"].map((jobDescriptionId) => ({
        evidence: [{ field: "work", quote: "内部分析依据" }],
        jobDescriptionId,
        matchedSkills: ["React"],
        profileHash: "hash",
        score: 0.9,
        warnings: ["核心技能需核实：Kotlin"],
      })),
      rerankedCount: 4,
      retrieval: "direct",
      tokenUsage: 100,
      version: "smart-upload-v1",
    };
    await render();
    expect(document.body.textContent).not.toContain("核心技能需核实");
    expect(document.body.textContent).not.toContain("内部分析依据");
    expect(document.body.textContent).not.toContain("相关技能");
    await act(() => button("全选推荐岗位")?.click());
    await settle();
    expect(backend.task.items[0].selectedJobIds).toEqual(["manual-job", "job-a", "job-b"]);
    await act(() => button("取消全选")?.click());
    await settle();
    expect(backend.task.items[0].selectedJobIds).toEqual(["manual-job"]);
  });
  it("opens the resume filename through its authenticated task item preview", async () => {
    await render();
    expect(document.querySelector('dialog[aria-label="简历预览"]')).toBeNull();
    await act(() => button("test.pdf")?.click());
    expect(
      document.querySelector<HTMLDialogElement>('dialog[aria-label="简历预览"]')?.dataset.url,
    ).toBe("/api/w/work/studio/smart-resume-tasks/task/items/item/resume");
  });
  it("persists portfolio files and links per resume without changing the selected jobs", async () => {
    await render();
    await act(() => button("添加测试作品文件")?.click());
    await settle();
    expect(mocks.uploadPortfolio).toHaveBeenCalledWith("work", expect.any(File));
    expect(backend.task.items[0].selectedJobIds).toEqual(["job-a"]);
    expect(document.body.textContent).toContain("作品.pdf");
    expect(
      document.querySelector('a[href$="/items/item/portfolio/portfolio-id?download=1"]'),
    ).not.toBeNull();
    await act(() => button("添加测试作品链接")?.click());
    await settle();
    expect(backend.task.items[0].portfolioAttachments).toHaveLength(2);
    expect(document.querySelector('a[href="https://example.com/portfolio"]')?.textContent).toBe(
      "个人网站",
    );
    await act(() => root?.unmount());
    root = null;
    client?.clear();
    document.body.innerHTML = "";
    await render();
    expect(document.body.textContent).toContain("作品.pdf");
    expect(document.body.textContent).toContain("个人网站");
    expect(backend.task.items[0].selectedJobIds).toEqual(["job-a"]);
  });
  it("prevents submission and closing while a portfolio upload is pending", async () => {
    const callbacks = await render();
    const pending = Promise.withResolvers<{
      id: string;
      mimeType: string;
      name: string;
      size: number;
    }>();
    mocks.uploadPortfolio.mockReturnValueOnce(pending.promise);
    await act(() => button("添加测试作品文件")?.click());
    await settle();
    expect(button("确认提交")?.disabled).toBe(true);
    expect(button("稍后处理")?.disabled).toBe(true);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    await act(() =>
      pending.resolve({
        id: "portfolio-id",
        mimeType: "application/pdf",
        name: "作品.pdf",
        size: 9,
      }),
    );
    await settle();
    expect(button("确认提交")?.disabled).toBe(false);
    expect(document.body.textContent).toContain("作品.pdf");
  });
  it("allows closing a running task and fetches its updated state after reopening", async () => {
    backend.task.items[0].status = "processing";
    backend.task.items[0].selectedJobIds = [];
    const callbacks = await render();
    expect(button("确认提交")?.disabled).toBe(true);
    await act(() => button("稍后处理")?.click());
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    await act(() => root?.unmount());
    root = null;
    client?.clear();
    document.body.innerHTML = "";
    backend.task.items[0].status = "ready";
    backend.task.items[0].selectedJobIds = ["job-a"];
    await render();
    expect(button("确认提交")?.disabled).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("persists a changed destination and restores it on a fresh mount before submission", async () => {
    await render();
    const select = document.querySelector<HTMLSelectElement>("select[multiple]");
    if (!select) {
      throw new Error("Missing destination selector");
    }
    await act(() => {
      for (const option of select.options) {
        option.selected = option.value === "job-b";
      }
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(mocks.save).toHaveBeenCalledWith("work", "task", {
      items: [{ itemId: "item", jobDescriptionIds: ["job-b"], skipped: false }],
    });
    await act(() => root?.unmount());
    root = null;
    client?.clear();
    document.body.innerHTML = "";
    const callbacks = await render();
    expect(
      document.querySelector<HTMLSelectElement>("select[multiple]")?.selectedOptions[0]?.value,
    ).toBe("job-b");
    await act(() => button("确认提交")?.click());
    await settle();
    expect(mocks.submit).toHaveBeenCalledWith("work", "task");
    expect(callbacks.onSubmitted).toHaveBeenCalledOnce();
  });
  it("requires complete source information only for resumes being admitted", async () => {
    backend.task.recruitmentSource = null;
    await render();
    expect(button("确认提交")?.disabled).toBe(true);
    await changeSource("referral");
    expect(button("确认提交")?.disabled).toBe(true);
    await changeSourceDetail("推荐人甲");
    expect(button("确认提交")?.disabled).toBe(false);
    await changeSource("other");
    expect(button("确认提交")?.disabled).toBe(true);
    backend.task.items[0].skipped = true;
    await act(async () => {
      await client?.invalidateQueries();
    });
    await settle();
    expect(button("确认提交")?.disabled).toBe(false);
  });
  it("keeps an unsaved source draft through refetch and persists it before closing", async () => {
    const callbacks = await render();
    await changeSource("referral");
    await changeSourceDetail("  推荐人甲  ");
    await act(async () => {
      await client?.invalidateQueries();
    });
    expect(sourceSelect()?.value).toBe("referral");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="来源详情"]')?.value).toBe(
      "  推荐人甲  ",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    await act(() => button("稍后处理")?.click());
    await settle();
    expect(mocks.save).toHaveBeenCalledWith("work", "task", {
      recruitmentSource: "referral",
      recruitmentSourceDetail: "推荐人甲",
    });
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    await act(() => root?.unmount());
    root = null;
    client?.clear();
    document.body.innerHTML = "";
    await render();
    expect(sourceSelect()?.value).toBe("referral");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="来源详情"]')?.value).toBe(
      "推荐人甲",
    );
  });
  it("saves a changed source before submitting and clears the previous source detail", async () => {
    backend.task.recruitmentSource = "referral";
    backend.task.recruitmentSourceDetail = "旧推荐人";
    const callbacks = await render();
    await changeSource("boss");
    await act(() => button("确认提交")?.click());
    await settle();
    expect(mocks.save).toHaveBeenCalledWith("work", "task", {
      recruitmentSource: "boss",
      recruitmentSourceDetail: null,
    });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submit.mock.invocationCallOrder[0],
    );
    expect(callbacks.onSubmitted).toHaveBeenCalledOnce();
  });
  it("retains the draft when saving fails and prevents close or submission", async () => {
    const callbacks = await render();
    await changeSource("other");
    await changeSourceDetail("招聘会");
    mocks.save.mockRejectedValue(new Error("保存失败"));
    await act(() => button("稍后处理")?.click());
    await settle();
    expect(callbacks.onClose).not.toHaveBeenCalled();
    await act(() => button("确认提交")?.click());
    await settle();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(sourceSelect()?.value).toBe("other");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="来源详情"]')?.value).toBe(
      "招聘会",
    );
    expect(callbacks.onSubmitted).not.toHaveBeenCalled();
  });
  it("disables editing and task actions until source saving finishes", async () => {
    const callbacks = await render();
    await changeSource("referral");
    await changeSourceDetail("推荐人甲");
    const pending = Promise.withResolvers<{ saved: boolean }>();
    mocks.save.mockReturnValueOnce(pending.promise);
    await act(() => button("保存来源")?.click());
    await settle();
    expect(sourceSelect()?.disabled).toBe(true);
    expect(button("稍后处理")?.disabled).toBe(true);
    expect(button("确认提交")?.disabled).toBe(true);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    backend.task.recruitmentSource = "referral";
    backend.task.recruitmentSourceDetail = "推荐人甲";
    await act(() => pending.resolve({ saved: true }));
    await settle();
    expect(sourceSelect()?.disabled).toBe(false);
    expect(button("保存来源")?.disabled).toBe(true);
    expect(button("确认提交")?.disabled).toBe(false);
  });
});
