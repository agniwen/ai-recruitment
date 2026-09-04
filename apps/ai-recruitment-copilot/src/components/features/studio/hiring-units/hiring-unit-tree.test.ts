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
        memberId: "member-1",
        name: "ODC 一",
        userId: "user-1",
      },
      {
        email: "odc-2@example.com",
        image: null,
        memberId: "member-2",
        name: "ODC 二",
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
      expect.objectContaining({ id: "department-1", rowType: "department", treeDepth: 1 }),
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
      new URL("../../../../routes/w.$slug.studio.hiring-units.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain('["hiring-units"].tree.$get');
    expect(source).not.toContain("useDataGridState");
    expect(source).not.toMatch(/pagination=\{/u);
    expect(source).toContain("row.odcMembers");
  });

  it("submits multiple ODC members for one hiring unit or department", () => {
    const source = readFileSync(new URL("odc-assignment-dialog.tsx", import.meta.url), "utf-8");

    expect(source).toContain("<SearchableMultiSelect");
    expect(source).toContain("json: { memberIds }");
    expect(source).toContain("target?.odcMembers.map");
  });
});
