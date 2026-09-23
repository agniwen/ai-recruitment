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
    value,
    options,
  }: {
    id: string;
    onChange: (value: string[]) => void;
    value: string[];
    options: { value: string; label: string }[];
  }) => (
    <select
      id={id}
      multiple
      value={value}
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

const defaultOptions = {
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
};

function selectValues(id: string, values: string[]) {
  act(() => {
    const select = document.querySelector<HTMLSelectElement>(`#${id}`);
    if (!select) {
      throw new Error(`Missing selector: ${id}`);
    }
    for (const option of select.options) {
      option.selected = values.includes(option.value);
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function selectSource() {
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="选择简历来源"]')?.click());
  act(() => {
    const boss = [...document.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent === "Boss直聘",
    );
    boss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function renderDialog(
  onConfirmed: (files: File[], config: BulkUploadConfirmConfig) => void,
  options = defaultOptions,
  fileCount = 1,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const files = Array.from(
    { length: fileCount },
    (_, index) => new File(["resume"], `resume-${index}.pdf`, { type: "application/pdf" }),
  );

  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(["candidate-import-options", "workspace"], options);
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
    selectValues("resume-pool-import-hiring-unit", ["one", "two"]);
    expect(startButton?.disabled).toBe(false);
    expect(document.body.textContent).toContain("部门-one");
    expect(document.body.textContent).toContain("服务-two");
    expect(document.querySelector('[id^="import-department-"]')).toBeNull();
    expect(document.querySelector('[id^="import-service-"]')).toBeNull();
    act(() => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onConfirmed).toHaveBeenCalledWith(
      expect.any(Array),
      {
        dedupPolicy: "skip",
        destinations: [
          { hiringUnitId: "one", jobDescriptionId: "jd-one" },
          { hiringUnitId: "two", jobDescriptionId: "jd-two" },
        ],
        jdMode: "bind",
        jobDescriptionId: null,
        recruitmentSource: "boss",
        recruitmentSourceDetail: null,
      },
      [[]],
    );

    act(() => {
      root.unmount();
    });
  });
});

const multiOptions = {
  departments: [],
  hiringUnits: [
    { id: "tech", name: "技术中心" },
    { id: "operations-a", name: "运营中心" },
    { id: "operations-b", name: "运营中心" },
  ],
  jobDescriptions: [
    {
      departmentId: "d1",
      departmentName: "运营组",
      hiringUnitId: "tech",
      id: "REQ-001081",
      name: "中级运营",
      serviceUnit: "银河",
    },
    {
      departmentId: "d2",
      departmentName: "天枢",
      hiringUnitId: "tech",
      id: "REQ-000940",
      name: "中级运营",
      serviceUnit: "天枢",
    },
    {
      departmentId: "d3",
      departmentName: "动漫运营部",
      hiringUnitId: "operations-a",
      id: "REQ-001027",
      name: "中级运营",
      serviceUnit: "紫宸星宇",
    },
    {
      departmentId: "d4",
      departmentName: "运营1部",
      hiringUnitId: "operations-b",
      id: "REQ-000200",
      name: "中级运营",
      serviceUnit: "万有引力",
    },
    {
      departmentId: "d1",
      departmentName: "运营组",
      hiringUnitId: "tech",
      id: "senior",
      name: "高级运营",
      serviceUnit: "银河",
    },
  ],
};

function optionValues(id: string, selected = false) {
  const select = document.querySelector<HTMLSelectElement>(`#${id}`);
  if (!select) {
    throw new Error(`Missing selector: ${id}`);
  }
  return [...(selected ? select.selectedOptions : select.options)].map((option) => option.value);
}
function getStartButton() {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("开始上传"),
  );
  if (!button) {
    throw new Error("Missing upload button");
  }
  return button;
}

describe("job and organization multi-selection", () => {
  const relationOptions = {
    departments: [],
    hiringUnits: ["A", "B", "C"].map((id) => ({ id, name: `组织${id}` })),
    jobDescriptions: [
      ["A", "A"],
      ["A", "B"],
      ["B", "B"],
      ["B", "C"],
    ].map(([name, unit]) => ({
      departmentId: `dept-${unit}`,
      departmentName: `部门${unit}`,
      hiringUnitId: unit,
      id: `${name}-${unit}`,
      name: `岗位${name}`,
      serviceUnit: `服务${unit}`,
    })),
  };
  it.each([1, 2])(
    "previews and submits four real relations per resume for %i files, never six",
    (fileCount) => {
      const onConfirmed = vi.fn();
      const { root } = renderDialog(onConfirmed, relationOptions, fileCount);
      selectSource();
      expect(optionValues("candidate-import-job")).toEqual(["岗位A", "岗位B"]);
      selectValues("candidate-import-job", ["岗位A"]);
      expect(optionValues("resume-pool-import-hiring-unit")).toEqual(["A", "B"]);
      selectValues("candidate-import-job", ["岗位A", "岗位B"]);
      expect(optionValues("resume-pool-import-hiring-unit")).toEqual(["A", "B", "C"]);
      expect(optionValues("resume-pool-import-hiring-unit", true)).toEqual([]);
      selectValues("resume-pool-import-hiring-unit", ["A", "B", "C"]);
      expect(document.querySelectorAll("section")).toHaveLength(3);
      expect(document.querySelectorAll("[data-destination-id]")).toHaveLength(4);
      expect(getStartButton().textContent).toContain(`${fileCount * 4} 条记录`);
      act(() => getStartButton().click());
      expect(onConfirmed.mock.lastCall?.[1].destinations).toEqual([
        { hiringUnitId: "A", jobDescriptionId: "A-A" },
        { hiringUnitId: "B", jobDescriptionId: "A-B" },
        { hiringUnitId: "B", jobDescriptionId: "B-B" },
        { hiringUnitId: "C", jobDescriptionId: "B-C" },
      ]);
      expect(onConfirmed.mock.lastCall?.[0]).toHaveLength(fileCount);
      act(() => root.unmount());
    },
  );
  it("removes C from both options and selections when B is deselected, without restoring its check later", () => {
    const onConfirmed = vi.fn();
    const { root } = renderDialog(onConfirmed, relationOptions);
    selectSource();
    selectValues("candidate-import-job", ["岗位A", "岗位B"]);
    selectValues("resume-pool-import-hiring-unit", ["A", "B", "C"]);
    selectValues("candidate-import-job", ["岗位A"]);
    expect(optionValues("resume-pool-import-hiring-unit")).toEqual(["A", "B"]);
    expect(optionValues("resume-pool-import-hiring-unit", true)).toEqual(["A", "B"]);
    expect(document.querySelector('[data-destination-id="B-C"]')).toBeNull();
    expect(getStartButton().textContent).toContain("2 条记录");
    act(() => getStartButton().click());
    expect(onConfirmed.mock.lastCall?.[1].destinations).toHaveLength(2);
    selectValues("candidate-import-job", ["岗位A", "岗位B"]);
    expect(optionValues("resume-pool-import-hiring-unit")).toEqual(["A", "B", "C"]);
    expect(optionValues("resume-pool-import-hiring-unit", true)).toEqual(["A", "B"]);
    act(() => root.unmount());
  });
  it("supports organization-first OR filtering and removes unsupported selected job names", () => {
    const { root } = renderDialog(vi.fn(), relationOptions);
    selectSource();
    selectValues("resume-pool-import-hiring-unit", ["A", "C"]);
    expect(optionValues("candidate-import-job")).toEqual(["岗位A", "岗位B"]);
    selectValues("candidate-import-job", ["岗位A", "岗位B"]);
    expect(getStartButton().textContent).toContain("2 条记录");
    selectValues("resume-pool-import-hiring-unit", ["B"]);
    expect(optionValues("candidate-import-job", true)).toEqual(["岗位A", "岗位B"]);
    expect(getStartButton().textContent).toContain("2 条记录");
    selectValues("resume-pool-import-hiring-unit", ["A"]);
    expect(optionValues("candidate-import-job")).toEqual(["岗位A"]);
    expect(optionValues("candidate-import-job", true)).toEqual(["岗位A"]);
    expect(getStartButton().textContent).toContain("1 条记录");
    selectValues("candidate-import-job", []);
    expect(getStartButton().disabled).toBe(true);
    selectValues("resume-pool-import-hiring-unit", []);
    expect(optionValues("candidate-import-job")).toEqual(["岗位A", "岗位B"]);
    act(() => root.unmount());
  });
  it("keeps same-name organizations distinct and expands all concrete jobs under a selected name", () => {
    const onConfirmed = vi.fn();
    const { root } = renderDialog(onConfirmed, multiOptions);
    selectSource();
    selectValues("candidate-import-job", ["中级运营"]);
    selectValues("resume-pool-import-hiring-unit", ["tech", "operations-a", "operations-b"]);
    expect(document.querySelectorAll("section")).toHaveLength(3);
    expect(document.querySelectorAll("[data-destination-id]")).toHaveLength(4);
    expect(getStartButton().textContent).toContain("4 条记录");
    act(() => getStartButton().click());
    expect(
      onConfirmed.mock.lastCall?.[1].destinations.map(
        (row: { jobDescriptionId: string }) => row.jobDescriptionId,
      ),
    ).toEqual(["REQ-001081", "REQ-000940", "REQ-001027", "REQ-000200"]);
    selectValues("candidate-import-job", ["高级运营"]);
    expect(optionValues("resume-pool-import-hiring-unit", true)).toEqual(["tech"]);
    expect(getStartButton().textContent).toContain("1 条记录");
    act(() => root.unmount());
  });
  it("blocks more than 50 concrete destinations and allows reducing organizations", () => {
    const options = {
      ...multiOptions,
      jobDescriptions: Array.from({ length: 51 }, (_, index) => ({
        ...multiOptions.jobDescriptions[0],
        hiringUnitId: index === 50 ? "operations-a" : "tech",
        id: `job-${index}`,
      })),
    };
    const { root } = renderDialog(vi.fn(), options);
    selectSource();
    selectValues("candidate-import-job", ["中级运营"]);
    selectValues("resume-pool-import-hiring-unit", ["tech", "operations-a"]);
    expect(getStartButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("每次最多选择 50 个具体岗位去向");
    selectValues("resume-pool-import-hiring-unit", ["tech"]);
    expect(getStartButton().disabled).toBe(false);
    expect(getStartButton().textContent).toContain("50 条记录");
    act(() => root.unmount());
  });
});
