import { sscResponsibilityInputSchema } from "./schema";
import type { SscResponsibilityImport, SscResponsibilityInput } from "./schema";

export interface SscImportCatalog {
  roles: { value: string; label: string }[];
  resumeSources: { id: string; name: string }[];
  existing: {
    centerName: string;
    resumeSourceId: string | null;
    email: string;
    sscName: string;
    telegram: string;
    workspaceRole: string | null;
  }[];
}
export interface SscImportPreviewRow {
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
  return JSON.stringify([scope, person]);
}

export function previewSscResponsibilityRows(
  rows: SscResponsibilityImport["rows"],
  workspaceRole: string,
  catalog: SscImportCatalog,
): SscImportPreviewRow[] {
  const seen = new Set(catalog.existing.map((row) => identity(row, catalog.resumeSources)));
  return rows.map((row) => {
    const matches = sourceMatches(row.centerName, catalog.resumeSources);
    const input: SscResponsibilityInput = {
      centerName: matches.length === 1 ? matches[0].name : row.centerName.trim(),
      demandOwner: row.demandOwner.trim(),
      email: normalized(row.email),
      notes: row.notes.trim(),
      resumeSourceId: matches.length === 1 ? matches[0].id : null,
      sscName: row.sscName.trim(),
      telegram: row.telegram.trim(),
      workspaceRole,
    };
    let error: string | null = null;
    const parsed = sscResponsibilityInputSchema.safeParse(input);
    if (
      !catalog.roles.some((role) => role.value === workspaceRole) ||
      ["owner", "admin", "member", "noAccess"].includes(workspaceRole)
    ) {
      error = "请选择当前工作区的 SSC 审核角色。";
    } else if (!parsed.success) {
      error = parsed.error.issues[0]?.message ?? "请检查本行资料。";
    } else if (matches.length > 1) {
      error = "存在多个同名部门/中心，请先在系统中核对名称。";
    } else if (
      input.email &&
      catalog.existing.some(
        (existing) =>
          normalized(existing.email) === input.email &&
          existing.workspaceRole !== null &&
          existing.workspaceRole !== workspaceRole,
      )
    ) {
      error = "该邮箱已有其他 SSC 角色，请先核对负责关系。";
    }
    if (error) {
      return { error, input, row: row.row, status: "invalid" };
    }
    const key = identity(input, catalog.resumeSources);
    const status = seen.has(key) ? "existing" : "new";
    seen.add(key);
    return { error: null, input, row: row.row, status };
  });
}
