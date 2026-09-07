import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HiringUnitTreeNode } from "@arc/shared/hiring-units";
import { flattenHiringUnitTree } from "./hiring-unit-tree";

const tree: HiringUnitTreeNode[] = [
  {
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: null,
    departments: [
      {
        createdAt: "2026-09-02T00:00:00.000Z",
        description: "负责平台研发",
        hiringUnitId: "unit-1",
        id: "department-1",
        interviewerCount: 1,
        jobDescriptionCount: 2,
        name: "平台部",
        odcMembers: [],
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ],
    description: "核心业务",
    id: "unit-1",
    name: "研发中心",
    odcMembers: [
      {
        email: "odc-1@example.com",
        image: null,
        jobSeries: "直属",
        memberId: "member-1",
        name: "ODC 一",
        serviceUnit: "悦达",
        userId: "user-1",
      },
      {
        email: "odc-2@example.com",
        image: null,
        jobSeries: null,
        memberId: "member-2",
        name: "ODC 二",
        serviceUnit: null,
        userId: "user-2",
      },
    ],
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("flattenHiringUnitTree", () => {
  it("shows departments below an expanded hiring unit", () => {
    expect(flattenHiringUnitTree(tree, new Set(), "")).toEqual([
      expect.objectContaining({
        hasChildren: true,
        id: "unit-1",
        odcMembers: [
          expect.objectContaining({ memberId: "member-1" }),
          expect.objectContaining({ memberId: "member-2" }),
        ],
        rowType: "hiringUnit",
        treeDepth: 0,
      }),
      expect.objectContaining({
        id: "department-1",
        interviewerCount: 1,
        jobDescriptionCount: 2,
        rowType: "department",
        treeDepth: 1,
      }),
    ]);
  });

  it("hides departments below a collapsed hiring unit", () => {
    expect(flattenHiringUnitTree(tree, new Set(["unit-1"]), "")).toEqual([
      expect.objectContaining({ id: "unit-1", rowType: "hiringUnit" }),
    ]);
  });

  it("keeps the parent visible when a department matches search", () => {
    expect(flattenHiringUnitTree(tree, new Set(["unit-1"]), "平台")).toEqual([
      expect.objectContaining({ id: "unit-1", rowType: "hiringUnit" }),
      expect.objectContaining({ id: "department-1", rowType: "department" }),
    ]);
  });
});

describe("hiring unit management list", () => {
  it("loads the complete tree without pagination controls", () => {
    const source = readFileSync(
      new URL("hiring-unit-management-page.tsx", import.meta.url),
      "utf-8",
    );
    const avatarGroupSource = readFileSync(
      new URL("../odc-avatar-group.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain('["hiring-units"].tree.$get');
    expect(source).not.toContain("useDataGridState");
    expect(source).not.toMatch(/pagination=\{/u);
    expect(source).toContain("<OdcAvatarGroup members={row.odcMembers}");
    expect(avatarGroupSource).toContain("<AvatarGroup>");
    expect(avatarGroupSource).toContain("members.slice(0, 5)");
    expect(avatarGroupSource).toContain("<AvatarGroupCount");
    expect(source).toContain("minSize: 160");
    expect(source).toContain("maxSize: 160");
  });

  it("supports selecting mixed rows for overwrite-style batch ODC assignment", () => {
    const pageSource = readFileSync(
      new URL("hiring-unit-management-page.tsx", import.meta.url),
      "utf-8",
    );
    const dialogSource = readFileSync(
      new URL("../bulk-odc-assignment-dialog.tsx", import.meta.url),
      "utf-8",
    );

    expect(pageSource).toContain("selectColumn<HiringUnitTreeRow>({");
    expect(pageSource).toContain("rowSelection={rowSelection}");
    expect(pageSource).toContain("批量设置 ODC");
    expect(dialogSource).toContain('["hiring-units"].odc.batch.$put');
    expect(dialogSource).toContain("此操作会覆盖");
  });

  it("opens paginated ODC management from the action column", () => {
    const pageSource = readFileSync(
      new URL("hiring-unit-management-page.tsx", import.meta.url),
      "utf-8",
    );
    const modalSource = readFileSync(
      new URL("../odc-management-modal.tsx", import.meta.url),
      "utf-8",
    );
    const addDialogSource = readFileSync(
      new URL("../odc-add-dialog.tsx", import.meta.url),
      "utf-8",
    );

    expect(pageSource).toContain('label: "管理 ODC"');
    expect(pageSource).toContain("<OdcManagementModal");
    expect(modalSource).toContain("useModalPagination");
    expect(modalSource).toContain("<DataGrid<OdcManagedAssignment>");
    expect(modalSource).toContain("toolbarRight={");
    expect(modalSource).toContain("添加 ODC");
    expect(modalSource).toContain("<OdcAddDialog");
    expect(addDialogSource).toContain(".$post({");
    expect(modalSource).toContain('label: "编辑"');
    expect(modalSource).toContain('label: "删除"');
  });

  it("submits per-member ODC scopes for one hiring unit or department", () => {
    const source = readFileSync(new URL("../odc-assignment-dialog.tsx", import.meta.url), "utf-8");
    const scopeFieldsSource = readFileSync(
      new URL("../odc-assignment-scope-fields.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain("<SearchableMultiSelect");
    expect(source).toContain("serializeOdcAssignmentDrafts(assignments)");
    expect(source).toContain("target?.odcMembers.map");
    expect(scopeFieldsSource).toContain("不限序列");
    expect(scopeFieldsSource).toContain("直属");
    expect(scopeFieldsSource).toContain("派驻");
    expect(scopeFieldsSource).toContain("留空表示不限服务单位");
  });

  it("edits and safely deletes department rows from the tree", () => {
    const source = readFileSync(
      new URL("hiring-unit-management-page.tsx", import.meta.url),
      "utf-8",
    );
    const deleteDialogSource = readFileSync(
      new URL("../departments/department-delete-dialog.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain("<DepartmentFormDialog");
    expect(source).toContain('studio.departments[":id"].$delete');
    expect(source).toContain('row.rowType === "department" && canUpdateDepartment');
    expect(source).toContain('row.rowType === "department" && canDeleteDepartment');
    expect(deleteDialogSource).toContain("department.jobDescriptionCount > 0");
    expect(deleteDialogSource).toContain("confirmDisabled");
  });
});
