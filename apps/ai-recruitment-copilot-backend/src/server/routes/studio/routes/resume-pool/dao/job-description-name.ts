import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, jobDescription } from "@arc/db-schema/schema";
import { resolveDepartmentHiringUnitScopeCondition } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";

export async function loadBoundJobDescriptionNames(
  jobDescriptionIds: string[],
  organizationId: string,
  actorUserId: string,
): Promise<Map<string, string>> {
  const ids = [...new Set(jobDescriptionIds)];
  if (ids.length === 0) {
    return new Map();
  }
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId,
    organizationId,
  });
  const rows = await db
    .select({ id: jobDescription.id, name: jobDescription.name })
    .from(jobDescription)
    .innerJoin(department, eq(jobDescription.departmentId, department.id))
    .where(
      and(
        eq(jobDescription.organizationId, organizationId),
        inArray(jobDescription.id, ids),
        scopeCondition,
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * 取简历绑定岗位的名称，按组织隔离：只有当岗位属于该组织时才返回名字，
 * 否则返回 null（跨组织/未绑定），与列表查询的 org-scoped join 保持一致。
 */
export async function loadBoundJobDescriptionName(
  jobDescriptionId: string | null,
  organizationId: string,
  actorUserId: string,
): Promise<string | null> {
  if (!jobDescriptionId) {
    return null;
  }
  const names = await loadBoundJobDescriptionNames([jobDescriptionId], organizationId, actorUserId);
  return names.get(jobDescriptionId) ?? null;
}
