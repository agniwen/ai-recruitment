// @vitest-environment jsdom

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkUploadConfirmDialog } from "./bulk-upload-confirm-dialog";
import type { BulkUploadConfirmConfig } from "./bulk-upload-confirm-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "workspace" }));
vi.mock("@/lib/client/api/endpoints/bulk-resume-upload", () => ({
  getCandidateImportOptions: vi.fn(),
}));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    id,
    value,
    options,
    onChange,
  }: {
    id: string;
    value: string | null;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: ({
    id,
    onChange,
  }: {
    id: string;
    onChange: (value: string[]) => void;
  }) => (
    <button id={id} onClick={() => onChange(["one", "two"])}>
      选择两个组织
    </button>
  ),
}));

function renderDialog(onConfirmed: (files: File[], config: BulkUploadConfirmConfig) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const files = [new File(["resume"], "resume.pdf", { type: "application/pdf" })];

  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(["candidate-import-options", "workspace"], {
    departments: [],
    hiringUnits: [
      { id: "one", name: "组织一" },
      { id: "two", name: "组织二" },
    ],
    jobDescriptions: ["one", "two"].map((id) => ({
      departmentId: `dept-${id}`,
      departmentName: `部门-${id}`,
      hiringUnitId: id,
      id: `jd-${id}`,
      name: "工程师",
      serviceUnit: `服务-${id}`,
    })),
  });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <BulkUploadConfirmDialog
          files={files}
          onConfirmed={onConfirmed}
          onOpenChange={vi.fn()}
          onRemoveFile={vi.fn()}
          open={true}
        />
      </QueryClientProvider>,
    );
  });

  return { root };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("BulkUploadConfirmDialog", () => {
  it("requires both a source and bound job destinations, displaying derived fields", () => {
    const onConfirmed = vi.fn();
    const { root } = renderDialog(onConfirmed);
    const startButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("开始上传"),
    );

    expect(startButton).toBeTruthy();
    expect(startButton?.disabled).toBe(true);

    act(() => {
      const sourceTrigger = document.querySelector<HTMLButtonElement>(
        '[aria-label="选择简历来源"]',
      );
      sourceTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      const bossOption = [...document.querySelectorAll('[role="option"]')].find(
        (option) => option.textContent === "Boss直聘",
      );
      bossOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(startButton?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain("自动匹配岗位");
    expect(document.body.textContent).not.toContain("不绑定岗位");
    act(() => {
      const select = document.querySelector<HTMLSelectElement>("#candidate-import-job");
      if (select) {
        select.value = "工程师";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(startButton?.disabled).toBe(true);
    act(() => {
      document.querySelector<HTMLButtonElement>("#resume-pool-import-hiring-unit")?.click();
    });
    expect(startButton?.disabled).toBe(false);
    expect(document.body.textContent).toContain("部门-one");
    expect(document.body.textContent).toContain("服务-two");
    expect(document.querySelector('[id^="import-department-"]')).toBeNull();
    expect(document.querySelector('[id^="import-service-"]')).toBeNull();
    act(() => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onConfirmed).toHaveBeenCalledWith(expect.any(Array), {
      dedupPolicy: "skip",
      destinations: [
        { hiringUnitId: "one", jobDescriptionId: "jd-one" },
        { hiringUnitId: "two", jobDescriptionId: "jd-two" },
      ],
      jdMode: "bind",
      jobDescriptionId: null,
      recruitmentSource: "boss",
      recruitmentSourceDetail: null,
    });

    act(() => {
      root.unmount();
    });
  });
});
