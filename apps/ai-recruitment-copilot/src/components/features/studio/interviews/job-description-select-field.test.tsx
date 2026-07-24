// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDescriptionSelectField } from "./job-description-select-field";

const queryMocks = vi.hoisted(() => ({
  records: [] as {
    aiInterviewDisabled: boolean;
    departmentName: string;
    id: string;
    interviewers: { name: string }[];
    name: string;
  }[],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: queryMocks.records }),
}));

vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceSlug: () => "workspace",
}));

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ options }: { options: { label: string }[] }) => (
    <div data-testid="job-options">{options.map((option) => option.label).join("|")}</div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];

function job(id: string, name: string, aiInterviewDisabled: boolean) {
  return {
    aiInterviewDisabled,
    departmentName: "研发部",
    id,
    interviewers: [],
    name,
  };
}

afterEach(() => {
  for (const { host, root } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

describe("JobDescriptionSelectField", () => {
  it("omits AI-disabled jobs when the caller enables filtering", () => {
    queryMocks.records = [
      job("jd-enabled", "可用岗位", false),
      job("jd-disabled", "禁用岗位", true),
    ];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push({ host, root });

    act(() => {
      root.render(
        <JobDescriptionSelectField hideAiInterviewDisabled onChange={vi.fn()} value="" />,
      );
    });

    expect(host.textContent).toContain("可用岗位");
    expect(host.textContent).not.toContain("禁用岗位");
  });
});
