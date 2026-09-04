import type {
  HiringUnitTreeDepartment,
  HiringUnitTreeNode,
  OdcMemberSummary,
} from "@arc/shared/hiring-units";

export interface HiringUnitTreeRow {
  createdAt: string | Date;
  createdBy: string | null;
  description: string | null;
  hasChildren: boolean;
  id: string;
  interviewerCount: number;
  jobDescriptionCount: number;
  name: string;
  odcMembers: OdcMemberSummary[];
  parentHiringUnitId: string | null;
  rowType: "department" | "hiringUnit";
  treeDepth: number;
  updatedAt: string | Date;
}

function matchesSearch(
  record: { description: string | null; name: string },
  normalizedSearch: string,
) {
  if (!normalizedSearch) {
    return true;
  }
  return `${record.name} ${record.description ?? ""}`
    .toLocaleLowerCase()
    .includes(normalizedSearch);
}

function departmentRow(record: HiringUnitTreeDepartment, treeDepth: number): HiringUnitTreeRow {
  return {
    createdAt: record.createdAt,
    createdBy: null,
    description: record.description,
    hasChildren: false,
    id: record.id,
    interviewerCount: record.interviewerCount,
    jobDescriptionCount: record.jobDescriptionCount,
    name: record.name,
    odcMembers: record.odcMembers,
    parentHiringUnitId: record.hiringUnitId,
    rowType: "department",
    treeDepth,
    updatedAt: record.updatedAt,
  };
}

export function flattenHiringUnitTree(
  tree: HiringUnitTreeNode[],
  collapsedHiringUnitIds: ReadonlySet<string>,
  search: string,
  unassignedDepartments: HiringUnitTreeDepartment[] = [],
): HiringUnitTreeRow[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const rows: HiringUnitTreeRow[] = [];

  for (const unit of tree) {
    const unitMatches = matchesSearch(unit, normalizedSearch);
    const matchingDepartments = unit.departments.filter((record) =>
      matchesSearch(record, normalizedSearch),
    );
    if (normalizedSearch && !unitMatches && matchingDepartments.length === 0) {
      continue;
    }
    rows.push({
      createdAt: unit.createdAt,
      createdBy: unit.createdBy,
      description: unit.description,
      hasChildren: unit.departments.length > 0,
      id: unit.id,
      interviewerCount: 0,
      jobDescriptionCount: 0,
      name: unit.name,
      odcMembers: unit.odcMembers,
      parentHiringUnitId: null,
      rowType: "hiringUnit",
      treeDepth: 0,
      updatedAt: unit.updatedAt,
    });

    if (!normalizedSearch && collapsedHiringUnitIds.has(unit.id)) {
      continue;
    }
    const visibleDepartments = unitMatches ? unit.departments : matchingDepartments;
    rows.push(...visibleDepartments.map((record) => departmentRow(record, 1)));
  }

  rows.push(
    ...unassignedDepartments
      .filter((record) => matchesSearch(record, normalizedSearch))
      .map((record) => departmentRow(record, 0)),
  );
  return rows;
}
