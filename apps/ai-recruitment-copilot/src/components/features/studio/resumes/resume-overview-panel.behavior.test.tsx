// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ResumeLibraryDetail } from "@arc/shared/studio-resumes";
import { ResumeOverviewPanel } from "./resume-overview-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  fetchSelectableHiringUnits: vi.fn(),
  updateStudioResumeIdentity: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  fetchSelectableHiringUnits: apiMocks.fetchSelectableHiringUnits,
  updateStudioResumeIdentity: apiMocks.updateStudioResumeIdentity,
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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderOverview(detail: ResumeLibraryDetail, jobBindingRequestKey?: number) {
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
          canEdit
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
