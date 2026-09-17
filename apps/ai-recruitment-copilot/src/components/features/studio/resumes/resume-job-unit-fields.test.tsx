// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeJobUnitFields } from "./resume-job-unit-fields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        departmentName: "运营部",
        hiringUnitId: "one",
        hiringUnitName: "运营中心",
        id: "a",
        name: "APP",
        resumeSourceName: "北斗-经纬",
        serviceUnit: "经纬",
      },
      {
        departmentName: "运营部",
        hiringUnitId: "two",
        hiringUnitName: "运营中心",
        id: "b",
        name: "APP",
        resumeSourceName: "北斗-万有引力",
        serviceUnit: "万有引力",
      },
      {
        departmentName: "增长部",
        hiringUnitId: "two",
        hiringUnitName: "运营中心",
        id: "c",
        name: "APP",
        resumeSourceName: "北斗-万有引力",
        serviceUnit: "万有引力",
      },
      {
        aiInterviewDisabled: true,
        hiringUnitId: "three",
        hiringUnitName: "技术中心",
        id: "d",
        name: "开发",
      },
    ],
    isError: false,
    isPending: false,
    isSuccess: true,
  }),
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
    options: { value: string; label: string; description?: string }[];
    onChange: (v: string | null) => void;
  }) => (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">请选择</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label} {o.description}
        </option>
      ))}
    </select>
  ),
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(unitId: string | null = null, jobId = "", hide = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [selection, setSelection] = useState({ jobId, unitId });
    return (
      <>
        <ResumeJobUnitFields
          units={[]}
          hiringUnitId={selection.unitId}
          jobDescriptionId={selection.jobId}
          onChange={(u, j) => setSelection({ jobId: j, unitId: u })}
          disabled={false}
          hideAiInterviewDisabled={hide}
          currentJobName="APP"
          currentUnitName="运营中心"
        />
        <output id="selection">{JSON.stringify(selection)}</output>
      </>
    );
  }
  act(() => root.render(<Harness />));
}
function choose(id: string, value: string) {
  act(() => {
    const select = host.querySelector<HTMLSelectElement>(`#${id}`);
    if (!select) {
      throw new Error(`Missing selector ${id}`);
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function values(id: string) {
  return [...host.querySelectorAll<HTMLOptionElement>(`#${id} option`)].map((o) => o.value);
}

describe("single resume job and organization selection", () => {
  it("filters organizations after choosing a job name and auto-selects a unique concrete job", () => {
    render();
    choose("resume-edit-job-name", "APP");
    expect(values("resume-edit-hiring-unit")).toEqual(["", "one", "two"]);
    choose("resume-edit-hiring-unit", "one");
    expect(host.querySelector("#selection")?.textContent).toContain('"jobId":"a"');
  });
  it("filters names by organization and requires a single concrete choice for duplicate jobs", () => {
    render();
    choose("resume-edit-hiring-unit", "two");
    expect(values("resume-edit-job-name")).toEqual(["", "APP"]);
    choose("resume-edit-job-name", "APP");
    expect(values("resume-edit-job-destination")).toEqual(["", "b", "c"]);
    choose("resume-edit-job-destination", "c");
    expect(host.querySelector("#selection")?.textContent).toContain('"jobId":"c"');
    choose("resume-edit-hiring-unit", "one");
    expect(host.querySelector("#selection")?.textContent).toContain('"jobId":"a"');
  });
  it("prefills an existing concrete destination and keeps center descriptions", () => {
    render("two", "c");
    expect(host.querySelector<HTMLSelectElement>("#resume-edit-job-destination")?.value).toBe("c");
    expect(host.textContent).toContain("北斗-万有引力");
  });
  it("retains the stage restriction and preserves unavailable historical values", () => {
    render("legacy", "old", true);
    expect(host.textContent).toContain("原岗位当前不在可选范围内");
    expect(host.querySelector("#selection")?.textContent).toContain('"jobId":"old"');
    choose("resume-edit-hiring-unit", "");
    choose("resume-edit-job-name", "");
    expect(values("resume-edit-job-name")).not.toContain("开发");
  });
});
