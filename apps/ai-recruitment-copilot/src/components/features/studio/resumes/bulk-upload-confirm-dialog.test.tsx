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

describe("same-name job multi-selection", () => {
  it("blocks more than 50 concrete destinations and allows reducing the selection", () => {
    const options = {
      ...multiOptions,
      jobDescriptions: Array.from({ length: 51 }, (_, index) => ({
        ...multiOptions.jobDescriptions[0],
        id: `job-${index}`,
      })),
    };
    const { root } = renderDialog(vi.fn(), options);
    selectSource();
    selectValues("candidate-import-job", ["中级运营"]);
    selectValues("resume-pool-import-hiring-unit", ["tech"]);
    selectValues(
      "import-job-0",
      options.jobDescriptions.map((job) => job.id),
    );
    const start = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("开始上传"),
    );
    expect(start?.disabled).toBe(true);
    expect(document.body.textContent).toContain("每次最多选择 50 个具体岗位去向");
    selectValues(
      "import-job-0",
      options.jobDescriptions.slice(0, 50).map((job) => job.id),
    );
    expect(start?.disabled).toBe(false);
    expect(start?.textContent).toContain("50 条记录");
    act(() => root.unmount());
  });
  it.each([1, 2])(
    "submits four flows per resume for %i files and preserves selections when organizations change",
    (fileCount) => {
      const onConfirmed = vi.fn();
      const { root } = renderDialog(onConfirmed, multiOptions, fileCount);
      selectSource();
      selectValues("candidate-import-job", ["中级运营"]);
      selectValues("resume-pool-import-hiring-unit", ["tech", "operations-a", "operations-b"]);
      const start = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("开始上传"),
      );
      expect(start?.disabled).toBe(true);
      expect(document.querySelectorAll("section")).toHaveLength(3);
      const jobSelect = document.querySelector<HTMLSelectElement>("#import-job-0");
      expect(jobSelect?.multiple).toBe(true);
      expect([...(jobSelect?.options ?? [])].map((option) => option.value)).toEqual([
        "REQ-001081",
        "REQ-000940",
      ]);
      selectValues("import-job-0", ["REQ-001081"]);
      expect(start?.textContent).toContain(`${fileCount * 3} 条记录`);
      selectValues("import-job-0", ["REQ-001081", "REQ-000940"]);
      expect(start?.textContent).toContain(`${fileCount * 4} 条记录`);
      expect(start?.disabled).toBe(false);
      act(() => start?.click());
      expect(onConfirmed).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          destinations: [
            { hiringUnitId: "tech", jobDescriptionId: "REQ-001081" },
            { hiringUnitId: "tech", jobDescriptionId: "REQ-000940" },
            { hiringUnitId: "operations-a", jobDescriptionId: "REQ-001027" },
            { hiringUnitId: "operations-b", jobDescriptionId: "REQ-000200" },
          ],
        }),
      );
      expect(onConfirmed.mock.calls[0][0]).toHaveLength(fileCount);
      selectValues("resume-pool-import-hiring-unit", ["tech", "operations-a"]);
      selectValues("resume-pool-import-hiring-unit", ["tech", "operations-a", "operations-b"]);
      expect([...(jobSelect?.selectedOptions ?? [])].map((option) => option.value)).toEqual([
        "REQ-001081",
        "REQ-000940",
      ]);
      selectValues("import-job-0", []);
      expect(start?.disabled).toBe(true);
      selectValues("import-job-0", ["REQ-001081", "REQ-000940"]);
      selectValues("resume-pool-import-hiring-unit", ["operations-a", "operations-b"]);
      expect(start?.textContent).toContain(`${fileCount * 2} 条记录`);
      act(() => start?.click());
      expect(onConfirmed.mock.lastCall?.[1].destinations).toHaveLength(2);
      act(() => root.unmount());
    },
  );

  it("clears old concrete jobs when switching the job name and auto-selects a sole match once", () => {
    const onConfirmed = vi.fn();
    const { root } = renderDialog(onConfirmed, multiOptions);
    selectSource();
    selectValues("candidate-import-job", ["中级运营"]);
    selectValues("resume-pool-import-hiring-unit", ["tech"]);
    selectValues("import-job-0", ["REQ-001081", "REQ-000940"]);
    selectValues("candidate-import-job", ["高级运营"]);
    expect(document.querySelector('[id^="import-job-"]')).toBeNull();
    const start = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("开始上传"),
    );
    expect(start?.textContent).toContain("1 条记录");
    act(() => start?.click());
    expect(onConfirmed.mock.lastCall?.[1].destinations).toEqual([
      { hiringUnitId: "tech", jobDescriptionId: "senior" },
    ]);
    selectValues("candidate-import-job", ["中级运营"]);
    expect(start?.disabled).toBe(true);
    expect(
      document.querySelector<HTMLSelectElement>("#import-job-0")?.selectedOptions,
    ).toHaveLength(0);
    act(() => root.unmount());
  });
});
