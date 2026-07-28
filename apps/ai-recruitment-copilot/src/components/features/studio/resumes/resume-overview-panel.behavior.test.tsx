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
  JobDescriptionSelectField: ({ value }: { value: string }) => (
    <input aria-label="关联岗位" readOnly value={value} />
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
    recommendationText: null,
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ResumeOverviewPanel canEdit detail={detail} slug="workspace" />
      </QueryClientProvider>,
    );
  });

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
  expect(age?.type).toBe("number");

  act(() => {
    if (hiringUnit) {
      hiringUnit.value = "unit-2";
      hiringUnit.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (targetRole) {
      setInputValue(targetRole, "新目标岗位");
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
          targetRole: "新目标岗位",
        }),
      );
    });
  });

  act(() => root.unmount());
  queryClient.clear();
});
