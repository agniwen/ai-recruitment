import { sscResponsibilityInputSchema } from "./schema";
import type { SscResponsibilityImport, SscResponsibilityInput } from "./schema";

export interface SscImportCatalog {
  departments?: { id: string; name: string }[];
  roles: { value: string; label: string }[];
  resumeSources: { id: string; name: string }[];
  existing: {
    centerName: string;
    departmentId?: string | null;
    resumeSourceId: string | null;
    serviceUnit?: string | null;
    email: string;
    sscName: string;
    telegram: string;
    workspaceRole: string | null;
  }[];
}
export interface SscImportPreviewRow {
  departmentName: string | null;
  row: number;
  status: "new" | "existing" | "invalid";
  input: SscResponsibilityInput;
  error: string | null;
}

const normalized = (value: string) => value.trim().toLowerCase();

function sourceMatches(name: string, sources: SscImportCatalog["resumeSources"]) {
  return sources.filter((source) => normalized(source.name) === normalized(name));
}

function identity(
  input: SscImportCatalog["existing"][number],
  sources: SscImportCatalog["resumeSources"],
) {
  const matches = sourceMatches(input.centerName, sources);
  const sourceId = input.resumeSourceId ?? (matches.length === 1 ? matches[0].id : null);
  const scope = sourceId ? `source:${sourceId}` : `name:${normalized(input.centerName)}`;
  let person = "unassigned";
  if (input.email.trim()) {
    person = `email:${normalized(input.email)}`;
  } else if (input.telegram.trim()) {
    person = `telegram:${normalized(input.telegram)}`;
  } else if (input.sscName.trim()) {
    person = `name:${normalized(input.sscName)}`;
  }
  return JSON.stringify([
    scope,
    person,
    normalized(input.serviceUnit ?? ""),
    input.departmentId ?? "",
  ]);
}

function resolveDepartment(name: string | undefined, catalog: SscImportCatalog) {
  const label = name?.trim() || null;
  if (!label) {
    return { departmentId: null, departmentName: null, error: null };
  }
  const matches = (catalog.departments ?? []).filter(
    (entry) => normalized(entry.name) === normalized(label),
  );
  if (matches.length === 1) {
    return { departmentId: matches[0].id, departmentName: matches[0].name, error: null };
  }
  return {
    departmentId: null,
    departmentName: label,
    error: matches.length
      ? "存在多个同名部门，请先在系统中核对部门名称。"
      : "部门不存在于当前工作区，请先在系统中维护部门。",
  };
}

function validateImportRow(
  input: SscResponsibilityInput,
  workspaceRole: string,
  catalog: SscImportCatalog,
  sourceCount: number,
  departmentError: string | null,
) {
  if (
    !catalog.roles.some((role) => role.value === workspaceRole) ||
    ["owner", "admin", "member", "noAccess"].includes(workspaceRole)
  ) {
    return "请选择当前工作区的 SSC 审核角色。";
  }
  const parsed = sscResponsibilityInputSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "请检查本行资料。";
  }
  if (sourceCount > 1) {
    return "存在多个同名部门/中心，请先在系统中核对名称。";
  }
  if (departmentError) {
    return departmentError;
  }
  if (
    input.email &&
    catalog.existing.some(
      (existing) =>
        normalized(existing.email) === input.email &&
        existing.workspaceRole !== null &&
        existing.workspaceRole !== workspaceRole,
    )
  ) {
    return "该邮箱已有其他 SSC 角色，请先核对负责关系。";
  }
  return null;
}

export function previewSscResponsibilityRows(
  rows: SscResponsibilityImport["rows"],
  workspaceRole: string,
  catalog: SscImportCatalog,
): SscImportPreviewRow[] {
  const seen = new Set(catalog.existing.map((row) => identity(row, catalog.resumeSources)));
  return rows.map((row) => {
    const matches = sourceMatches(row.centerName, catalog.resumeSources);
    const department = resolveDepartment(row.departmentName, catalog);
    const input: SscResponsibilityInput = {
      centerName: matches.length === 1 ? matches[0].name : row.centerName.trim(),
      demandOwner: row.demandOwner.trim(),
      departmentId: department.departmentId,
      email: normalized(row.email),
      notes: row.notes.trim(),
      resumeSourceId: matches.length === 1 ? matches[0].id : null,
      serviceUnit: row.serviceUnit?.trim() || null,
      sscName: row.sscName.trim(),
      telegram: row.telegram.trim(),
      workspaceRole,
    };
    const error = validateImportRow(
      input,
      workspaceRole,
      catalog,
      matches.length,
      department.error,
    );
    if (error) {
      return {
        departmentName: department.departmentName,
        error,
        input,
        row: row.row,
        status: "invalid",
      };
    }
    const key = identity(input, catalog.resumeSources);
    const status = seen.has(key) ? "existing" : "new";
    seen.add(key);
    return { departmentName: department.departmentName, error: null, input, row: row.row, status };
  });
}
