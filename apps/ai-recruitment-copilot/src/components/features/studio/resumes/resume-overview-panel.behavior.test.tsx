// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ResumeLibraryDetail } from "@arc/shared/studio-resumes";
import { ResumeOverviewPanel } from "./resume-overview-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  addStudioResumePortfolioLinks: vi.fn(),
  fetchSelectableHiringUnits: vi.fn(),
  updateStudioResumeIdentity: vi.fn(),
  updateStudioResumePortfolioLink: vi.fn(),
  uploadStudioResumePortfolio: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

vi.mock("@/lib/client/api", () => ({
  fetchSelectableHiringUnits: apiMocks.fetchSelectableHiringUnits,
  updateStudioResumeIdentity: apiMocks.updateStudioResumeIdentity,
}));

vi.mock("@/lib/client/api/endpoints/studio-resumes", () => ({
  addStudioResumePortfolioLinks: apiMocks.addStudioResumePortfolioLinks,
  deleteStudioResumePortfolio: vi.fn(),
  updateStudioResumePortfolioLink: apiMocks.updateStudioResumePortfolioLink,
  uploadStudioResumePortfolio: apiMocks.uploadStudioResumePortfolio,
}));

vi.mock("@/components/features/resume/resume-profile-view", () => ({
  ResumeProfileView: () => null,
}));

vi.mock("@/components/features/studio/job-descriptions/job-description-hover-card", () => ({
  JobDescriptionHoverCard: ({ name }: { name: string | null }) => <span>{name}</span>,
}));

vi.mock("@/components/features/studio/interviews/job-description-select-field", () => ({
  JobDescriptionSelectField: ({
    openRequestKey,
    value,
  }: {
    openRequestKey?: number;
    value: string;
  }) => (
    <input aria-label="关联岗位" data-open-request-key={openRequestKey} readOnly value={value} />
  ),
}));

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    id,
    onChange,
    options,
    value,
  }: {
    id: string;
    onChange: (value: string | null) => void;
    options: { label: string; value: string }[];
    value: string | null;
  }) => (
    <select id={id} onChange={(event) => onChange(event.target.value)} value={value ?? ""}>
      <option value="">请选择</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function makeDetail(): ResumeLibraryDetail {
  return {
    candidateEmail: "",
    candidateName: "候选人",
    candidatePhone: "",
    hiringUnitId: "unit-1",
    hiringUnitName: "原用人组织",
    id: "resume-1",
    jobDescriptionId: "job-1",
    jobDescriptionName: "关联岗位",
    recommendationText: "原推荐语",
    resumeEvaluationStatus: null,
    resumeParseStatus: "ready",
    resumeProfile: {
      age: 30,
      email: null,
      gender: "",
      name: "候选人",
      phone: null,
      targetRoles: ["旧目标岗位"],
      workYears: 8,
    },
    resumeReview: null,
    targetRole: "旧目标岗位",
  } as unknown as ResumeLibraryDetail;
}

function makeHiredDetail(): ResumeLibraryDetail {
  return {
    ...makeDetail(),
    closedMeta: {
      hiredDetails: {
        alias: "小王",
        preOnboardingTelegram: "@candidate-before",
        telegram: "@candidate",
      },
    },
    outcome: "hired",
    pipelineStage: "closed",
  } as unknown as ResumeLibraryDetail;
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderOverview(
  detail: ResumeLibraryDetail,
  jobBindingRequestKey?: number,
  canEdit = true,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ResumeOverviewPanel
          canEdit={canEdit}
          detail={detail}
          jobBindingRequestKey={jobBindingRequestKey}
          slug="workspace"
        />
      </QueryClientProvider>,
    );
  });

  return { container, queryClient, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it("submits editable hiring unit and target role from quick edit with a number age input", async () => {
  const detail = makeDetail();
  apiMocks.fetchSelectableHiringUnits.mockResolvedValue([
    { id: "unit-1", name: "原用人组织" },
    { id: "unit-2", name: "新用人组织" },
  ]);
  apiMocks.updateStudioResumeIdentity.mockResolvedValue(detail);

  const { container, queryClient, root } = renderOverview(detail);

  expect(container.textContent).toContain("候选人信息");
  expect(container.textContent).toContain("原推荐语");

  act(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="编辑候选人信息"]')?.click();
  });

  await act(async () => {
    await vi.waitFor(() => {
      expect(document.querySelector('#overview-hiring-unit option[value="unit-2"]')).not.toBeNull();
    });
  });

  const hiringUnit = document.querySelector<HTMLSelectElement>("#overview-hiring-unit");
  const targetRole = document.querySelector<HTMLInputElement>("#overview-target-role");
  const age = document.querySelector<HTMLInputElement>("#overview-age");
  const recommendationText = document.querySelector<HTMLTextAreaElement>(
    "#overview-recommendation-text",
  );
  expect(age?.type).toBe("number");
  expect(recommendationText?.value).toBe("原推荐语");

  act(() => {
    if (hiringUnit) {
      hiringUnit.value = "unit-2";
      hiringUnit.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (targetRole) {
      setInputValue(targetRole, "新目标岗位");
    }
    if (recommendationText) {
      setInputValue(recommendationText, "推荐给业务负责人");
    }
  });

  const saveButton = document.querySelector<HTMLButtonElement>('[aria-label="保存"]');
  expect(saveButton?.disabled).toBe(false);
  act(() => {
    saveButton?.click();
  });

  await act(async () => {
    await vi.waitFor(() => {
      expect(apiMocks.updateStudioResumeIdentity).toHaveBeenCalledWith(
        "workspace",
        "resume-1",
        expect.objectContaining({
          age: 30,
          hiringUnitId: "unit-2",
          recommendationText: "推荐给业务负责人",
          targetRole: "新目标岗位",
        }),
      );
    });
  });

  act(() => root.unmount());
  queryClient.clear();
});

it("shows and edits TG and alias fields only after hired", async () => {
  const detail = makeHiredDetail();
  apiMocks.fetchSelectableHiringUnits.mockResolvedValue([{ id: "unit-1", name: "原用人组织" }]);
  apiMocks.updateStudioResumeIdentity.mockResolvedValue(detail);

  const { container, queryClient, root } = renderOverview(detail);

  expect(container.textContent).toContain("@candidate");
  expect(container.textContent).toContain("@candidate-before");
  expect(container.textContent).toContain("小王");

  act(() => {
    container.querySelector<HTMLButtonElement>('[aria-label="编辑候选人信息"]')?.click();
  });

  await act(async () => {
    await vi.waitFor(() => {
      expect(
        container.querySelector('#overview-hiring-unit option[value="unit-1"]'),
      ).not.toBeNull();
    });
  });

  const telegram = container.querySelector<HTMLInputElement>("#overview-telegram");
  const preOnboardingTelegram = container.querySelector<HTMLInputElement>(
    "#overview-pre-onboarding-telegram",
  );
  const alias = container.querySelector<HTMLInputElement>("#overview-alias");
  expect(preOnboardingTelegram?.value).toBe("@candidate-before");
  expect(telegram?.value).toBe("@candidate");
  expect(alias?.value).toBe("小王");

  act(() => {
    if (preOnboardingTelegram) {
      setInputValue(preOnboardingTelegram, "@new-candidate-before");
    }
    if (telegram) {
      setInputValue(telegram, "@new-candidate");
    }
    if (alias) {
      setInputValue(alias, "新花名");
    }
  });
  act(() => {
    container.querySelector<HTMLButtonElement>('[aria-label="保存"]')?.click();
  });

  await act(async () => {
    await vi.waitFor(() => {
      expect(apiMocks.updateStudioResumeIdentity).toHaveBeenCalledWith(
        "workspace",
        "resume-1",
        expect.objectContaining({
          alias: "新花名",
          preOnboardingTelegram: "@new-candidate-before",
          telegram: "@new-candidate",
        }),
      );
    });
  });

  act(() => root.unmount());
  queryClient.clear();
});

it("does not show hired fields before the hired closed stage", () => {
  const detail = {
    ...makeHiredDetail(),
    outcome: "in_pipeline",
    pipelineStage: "offer",
  } as unknown as ResumeLibraryDetail;
  const { container, queryClient, root } = renderOverview(detail);

  expect(container.textContent).not.toContain("@candidate");
  expect(container.textContent).not.toContain("@candidate-before");
  expect(container.textContent).not.toContain("小王");
  expect(container.querySelector("#overview-telegram")).toBeNull();
  expect(container.querySelector("#overview-pre-onboarding-telegram")).toBeNull();
  expect(container.querySelector("#overview-alias")).toBeNull();

  act(() => root.unmount());
  queryClient.clear();
});

it("quick-edits a recommendation when the legacy record has no job or hiring unit", async () => {
  const detail = {
    ...makeDetail(),
    hiringUnitId: null,
    hiringUnitName: null,
    jobDescriptionId: null,
    jobDescriptionName: null,
    recommendationText: null,
  };
  apiMocks.fetchSelectableHiringUnits.mockResolvedValue([]);
  apiMocks.updateStudioResumeIdentity.mockResolvedValue(detail);

  const { queryClient, root } = renderOverview(detail);

  act(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="编辑候选人信息"]')?.click();
  });

  const recommendationText = document.querySelector<HTMLTextAreaElement>(
    "#overview-recommendation-text",
  );
  act(() => {
    if (recommendationText) {
      setInputValue(recommendationText, "推荐给业务负责人");
    }
  });
  await act(async () => {
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLButtonElement>('[aria-label="保存"]')?.disabled).toBe(
        false,
      );
    });
    document.querySelector<HTMLButtonElement>('[aria-label="保存"]')?.click();
  });

  await act(async () => {
    await vi.waitFor(() => {
      expect(apiMocks.updateStudioResumeIdentity).toHaveBeenCalledWith(
        "workspace",
        "resume-1",
        expect.objectContaining({
          hiringUnitId: null,
          jobDescriptionId: null,
          recommendationText: "推荐给业务负责人",
        }),
      );
    });
  });

  act(() => root.unmount());
  queryClient.clear();
});

it("enters quick edit and requests the linked-job select to open", async () => {
  const detail = {
    ...makeDetail(),
    jobDescriptionId: null,
    jobDescriptionName: null,
  };
  apiMocks.fetchSelectableHiringUnits.mockResolvedValue([]);

  const { container, queryClient, root } = renderOverview(detail, 1);

  await act(async () => {
    await vi.waitFor(() => {
      const jobSelect = container.querySelector<HTMLInputElement>('[aria-label="关联岗位"]');
      expect(jobSelect).not.toBeNull();
      expect(jobSelect?.dataset.openRequestKey).toBe("1");
    });
  });

  expect(container.querySelector('[aria-label="保存"]')).not.toBeNull();

  act(() => root.unmount());
  queryClient.clear();
});

it("uploads from an empty overview without editing or saving candidate identity", async () => {
  const attachment = { id: "portfolio-1", mimeType: "application/pdf", name: "作品.pdf", size: 4 };
  apiMocks.uploadStudioResumePortfolio.mockResolvedValue(attachment);
  const { container, queryClient, root } = renderOverview(makeDetail());
  expect(container.textContent).toContain("暂无作品集");
  const input = container.querySelector<HTMLInputElement>('[aria-label="上传作品集附件"]');
  expect(input).not.toBeNull();
  const file = new File(["work"], "作品.pdf", { type: "application/pdf" });
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file] });
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  expect(apiMocks.uploadStudioResumePortfolio).toHaveBeenCalledWith(
    "workspace",
    "resume-1",
    file,
    true,
  );
  expect(apiMocks.updateStudioResumeIdentity).not.toHaveBeenCalled();
  expect(container.textContent).toContain("作品.pdf");
  expect(container.textContent).toContain("查看");
  expect(container.querySelector('[aria-label="保存"]')).toBeNull();
  act(() => root.unmount());
  queryClient.clear();
});

it("keeps successful files visible when a later upload fails and allows retry", async () => {
  const attachment = { id: "portfolio-1", mimeType: "application/pdf", name: "成功.pdf", size: 4 };
  apiMocks.uploadStudioResumePortfolio
    .mockResolvedValueOnce(attachment)
    .mockRejectedValueOnce(new Error("上传失败"));
  const { container, queryClient, root } = renderOverview(makeDetail());
  const input = container.querySelector<HTMLInputElement>('[aria-label="上传作品集附件"]');
  await act(async () => {
    Object.defineProperty(input, "files", {
      value: [new File(["work"], "成功.pdf"), new File(["work"], "失败.pdf")],
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  expect(container.textContent).toContain("成功.pdf");
  expect(container.textContent).not.toContain("失败.pdf");
  expect(input?.disabled).toBe(false);
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="编辑候选人信息"]')?.disabled,
  ).toBe(false);
  act(() => root.unmount());
  queryClient.clear();
});

it("does not expose uploads without candidate update permission", () => {
  const { container, queryClient, root } = renderOverview(makeDetail(), undefined, false);
  expect(container.querySelector('[aria-label="上传作品集附件"]')).toBeNull();
  act(() => root.unmount());
  queryClient.clear();
});

function click(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>("button,[role=menuitem]")].find(
    (item) => item.textContent === text,
  );
  if (!element) {
    throw new Error(`Missing: ${text}`);
  }
  element.click();
}
function enter(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!element) {
    throw new Error(`Missing: ${label}`);
  }
  setInputValue(element, value);
}

it("adds several links from the overview and edits one without saving candidate identity", async () => {
  const existing = {
    id: crypto.randomUUID(),
    kind: "link" as const,
    name: "旧作品",
    url: "https://example.com/old",
  };
  const added = [
    {
      id: crypto.randomUUID(),
      kind: "link" as const,
      name: "https://example.com/new",
      url: "https://example.com/new",
    },
    {
      id: crypto.randomUUID(),
      kind: "link" as const,
      name: "https://github.com/example",
      url: "https://github.com/example",
    },
  ];
  apiMocks.addStudioResumePortfolioLinks.mockResolvedValue({ attachments: [existing, ...added] });
  apiMocks.updateStudioResumePortfolioLink.mockResolvedValue({
    attachments: [{ ...existing, name: "新名称" }, ...added],
  });
  const { container, queryClient, root } = renderOverview({
    ...makeDetail(),
    portfolioAttachments: [existing],
  });

  act(() => click("添加作品集"));
  act(() => click("添加链接"));
  act(() => {
    enter("链接地址 1", added[0].url);
    click("再添加一个链接");
  });
  act(() => enter("链接地址 2", added[1].url));
  await act(async () => {
    click("添加 2 个链接");
    await Promise.resolve();
  });
  expect(apiMocks.addStudioResumePortfolioLinks).toHaveBeenCalledWith(
    "workspace",
    "resume-1",
    added.map(({ name, url }) => ({ name, url })),
  );
  expect(container.textContent).toContain("旧作品");
  expect(container.textContent).toContain(added[1].url);
  act(() => click("编辑"));
  act(() => enter("显示名称 1", "新名称"));
  await act(async () => {
    click("保存");
    await Promise.resolve();
  });
  expect(apiMocks.updateStudioResumePortfolioLink).toHaveBeenCalledWith(
    "workspace",
    "resume-1",
    existing.id,
    { name: "新名称", url: existing.url },
  );
  expect(container.textContent).toContain("新名称");
  expect(apiMocks.updateStudioResumeIdentity).not.toHaveBeenCalled();
  act(() => root.unmount());
  queryClient.clear();
});
