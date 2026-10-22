import { createHash, randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  acquireSscProvisioningLock,
  syncSscMemberRole,
} from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import {
  department,
  organizationRole,
  resumeSource,
  sscResponsibility,
} from "@arc/db-schema/schema";
import { duplicateError } from "./dao";
import { previewSscResponsibilityRows } from "./import-matching";
import type { SscResponsibilityImport, SscResponsibilityImportCommit } from "./schema";
import type { SscImportPreviewRow } from "./import-matching";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadCatalog(organizationId: string, tx: Transaction) {
  const roles = await tx
    .select({ label: organizationRole.name, value: organizationRole.role })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.isSsc, true),
        eq(organizationRole.isOdc, false),
        notInArray(organizationRole.role, ["owner", "admin", "member", "noAccess"]),
      ),
    )
    .for("share");
  const resumeSources = await tx
    .select({ id: resumeSource.id, name: resumeSource.name })
    .from(resumeSource)
    .where(eq(resumeSource.organizationId, organizationId))
    .for("share");
  const existing = await tx
    .select({
      centerName: sscResponsibility.centerName,
      departmentId: sscResponsibility.departmentId,
      email: sscResponsibility.email,
      resumeSourceId: sscResponsibility.resumeSourceId,
      serviceUnit: sscResponsibility.serviceUnit,
      sscName: sscResponsibility.sscName,
      telegram: sscResponsibility.telegram,
      workspaceRole: sscResponsibility.workspaceRole,
    })
    .from(sscResponsibility)
    .where(eq(sscResponsibility.organizationId, organizationId))
    .for("share");
  const departments = await tx
    .select({ id: department.id, name: department.name })
    .from(department)
    .where(eq(department.organizationId, organizationId))
    .for("share");
  return { departments, existing, resumeSources, roles };
}

function previewHash(rows: SscImportPreviewRow[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function previewSscResponsibilityImport(
  organizationId: string,
  input: SscResponsibilityImport,
) {
  return db.transaction(async (tx) => {
    const rows = previewSscResponsibilityRows(
      input.rows,
      input.workspaceRole,
      await loadCatalog(organizationId, tx),
    );
    return { previewHash: previewHash(rows), rows };
  });
}

class ImportRoleConflictError extends Error {
  override name = "ImportRoleConflictError";
}

export async function importSscResponsibilities(
  organizationId: string,
  input: SscResponsibilityImportCommit,
) {
  try {
    return await db.transaction(async (tx) => {
      await acquireSscProvisioningLock(tx, organizationId);
      const rows = previewSscResponsibilityRows(
        input.rows,
        input.workspaceRole,
        await loadCatalog(organizationId, tx),
      );
      if (previewHash(rows) !== input.previewHash) {
        return { error: "导入匹配结果已变化，请重新上传并核对预览。", ok: false as const, rows };
      }
      if (rows.some((row) => row.status === "invalid")) {
        return {
          error: "导入资料或工作区配置已变化，请检查后重新预览。",
          ok: false as const,
          rows,
        };
      }
      const additions = rows.filter((row) => row.status === "new");
      if (additions.length) {
        await tx.insert(sscResponsibility).values(
          additions.map((row) => ({
            ...row.input,
            id: randomUUID(),
            organizationId,
          })),
        );
        const emails = new Set(additions.map((row) => row.input.email).filter(Boolean));
        for (const email of emails) {
          const result = await syncSscMemberRole(tx, {
            allowExistingRoleUpdate: true,
            email,
            organizationId,
            workspaceRole: input.workspaceRole,
          });
          if (result.status === "role_conflict" || result.status === "ambiguous_email") {
            throw new ImportRoleConflictError();
          }
        }
      }
      return {
        added: additions.length,
        ok: true as const,
        skipped: rows.length - additions.length,
      };
    });
  } catch (error) {
    if (error instanceof ImportRoleConflictError || duplicateError(error)) {
      return {
        error: "成员角色或负责关系存在冲突，本次未导入，请核对后重新预览。",
        ok: false as const,
        rows: [],
      };
    }
    throw error;
  }
}
