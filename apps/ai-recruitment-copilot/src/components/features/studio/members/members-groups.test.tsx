// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecruitingGroupsPanel } from "./members-groups";
import type { RecruitingGroupRow } from "./members-page-model";

vi.mock("@/components/ui/searchable-multi-select", () => ({
  SearchableMultiSelect: ({
    onChange,
    options,
    value,
  }: {
    onChange: (value: string[]) => void;
    options: { label: string; value: string }[];
    value: string[];
  }) => (
    <button aria-label="负责用人组织" onClick={() => onChange(["unit-2"])} type="button">
      {options
        .filter((option) => value.includes(option.value))
        .map((option) => option.label)
        .join(",")}
    </button>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group: RecruitingGroupRow = {
  createdAt: "2026-07-13T00:00:00.000Z",
  hiringUnitIds: ["unit-1"],
  hiringUnits: [{ id: "unit-1", name: "研发中心" }],
  id: "group-1",
  isDefault: false,
  memberUserIds: [],
  members: [],
  name: "技术招聘组",
};

const mountedRoots: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];

function renderPanel({
  canUpdate,
  hiringUnitGroup = group,
  onHiringUnitsChange = vi.fn(),
}: {
  canUpdate: boolean;
  hiringUnitGroup?: RecruitingGroupRow;
  onHiringUnitsChange?: (group: RecruitingGroupRow, hiringUnitIds: string[]) => void;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push({ host, root });

  act(() => {
    root.render(
      <RecruitingGroupsPanel
        allRows={[]}
        canUpdate={canUpdate}
        groupNameDrafts={{}}
        groups={[hiringUnitGroup]}
        hiringUnitOptions={[
          { label: "研发中心", value: "unit-1" },
          { label: "产品中心", value: "unit-2" },
        ]}
        newGroupName=""
        onAddMemberToGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onGroupNameDraftChange={vi.fn()}
        onHiringUnitsChange={onHiringUnitsChange}
        onMoveMemberToGroup={vi.fn()}
        onRemoveGroupMember={vi.fn()}
        onRenameGroup={vi.fn()}
        onRoleChange={vi.fn()}
        pending={null}
        setNewGroupName={vi.fn()}
      />,
    );
  });

  return host;
}

afterEach(() => {
  for (const { host, root } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

describe("RecruitingGroupsPanel hiring unit scope", () => {
  it("lets updaters replace the hiring units assigned to a recruiting group", () => {
    const onHiringUnitsChange = vi.fn();
    const host = renderPanel({ canUpdate: true, onHiringUnitsChange });

    const selector = host.querySelector<HTMLButtonElement>('button[aria-label="负责用人组织"]');
    expect(selector?.textContent).toBe("研发中心");

    act(() => selector?.click());

    expect(onHiringUnitsChange).toHaveBeenCalledWith(group, ["unit-2"]);
  });

  it("shows assigned hiring units read-only when update permission is absent", () => {
    const host = renderPanel({ canUpdate: false });

    expect(host.querySelector('button[aria-label="负责用人组织"]')).toBeNull();
    expect(host.textContent).toContain("研发中心");
  });

  it("labels an empty read-only assignment as public departments only", () => {
    const host = renderPanel({
      canUpdate: false,
      hiringUnitGroup: { ...group, hiringUnitIds: [], hiringUnits: [] },
    });

    expect(host.textContent).toContain("仅公共部门");
  });
});
