import { randomUUID } from "node:crypto";
import { and, eq, asc, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  hiringUnit,
  member,
  organizationRole,
  resumeSource,
  resumeSourceOdcMember,
  odcDepartmentResponsibility,
  user,
} from "@arc/db-schema/schema";
import { matchDepartments, normalizeScopeName } from "./matching";
import type { z } from "zod";
import type { responsibilityInput, scopeInput } from "./schema";

type Executor = Pick<typeof db, "select">;
export async function loadResponsibilityCatalog(organizationId: string, executor: Executor = db) {
  const [members, centers, departments, assignments, responsibilities] = await Promise.all([
    executor
      .select({
        email: user.email,
        id: member.id,
        isOdc: organizationRole.isOdc,
        name: user.name,
        telegram: user.telegram,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .leftJoin(
        organizationRole,
        and(
          eq(organizationRole.organizationId, member.organizationId),
          eq(organizationRole.role, member.role),
        ),
      )
      .where(eq(member.organizationId, organizationId))
      .orderBy(asc(user.name)),
    executor
      .select({ id: resumeSource.id, name: resumeSource.name })
      .from(resumeSource)
      .where(eq(resumeSource.organizationId, organizationId))
      .orderBy(asc(resumeSource.name)),
    executor
      .select({
        hiringUnitName: hiringUnit.name,
        id: department.id,
        name: department.name,
        resumeSourceId: hiringUnit.resumeSourceId,
      })
      .from(department)
      .innerJoin(
        hiringUnit,
        and(
          eq(hiringUnit.id, department.hiringUnitId),
          eq(hiringUnit.organizationId, department.organizationId),
        ),
      )
      .where(eq(department.organizationId, organizationId))
      .orderBy(asc(department.name)),
    executor
      .select()
      .from(resumeSourceOdcMember)
      .where(eq(resumeSourceOdcMember.organizationId, organizationId)),
    executor
      .select()
      .from(odcDepartmentResponsibility)
      .where(eq(odcDepartmentResponsibility.organizationId, organizationId)),
  ]);
  return {
    assignments,
    centers,
    departments,
    members,
    responsibilities: responsibilities.map(({ createdAt, ...row }) => ({
      ...row,
      createdAt: createdAt.toISOString(),
    })),
  };
}

export function previewResponsibilityRows(
  rows: z.infer<typeof responsibilityInput>[],
  catalog: Awaited<ReturnType<typeof loadResponsibilityCatalog>>,
) {
  return rows.map((row, index) => {
    const members = catalog.members.filter(
      (m) => normalizeScopeName(m.email) === normalizeScopeName(row.email),
    );
    const centers = catalog.centers.filter(
      (c) => normalizeScopeName(c.name) === normalizeScopeName(row.center),
    );
    const person = members.length === 1 ? members[0] : undefined;
    const center = centers.length === 1 ? centers[0] : undefined;
    const matched = matchDepartments(
      row.departments,
      catalog.departments.filter((d) => d.resumeSourceId === center?.id),
    );
    let { error } = matched;
    if (!person) {
      error = "邮箱未匹配到唯一工作区成员（预录入账号须先加入工作区）";
    } else if (!person.isOdc) {
      error = "该成员角色未标记为 ODC";
    } else if (!center) {
      error = "中心不存在或名称不唯一";
    }
    const existing = catalog.responsibilities.filter(
      (r) => r.memberId === person?.id && r.resumeSourceId === center?.id,
    );
    const duplicate =
      existing.some((r) => r.departmentId === null) ||
      (matched.allDepartments
        ? false
        : matched.departmentIds.every((id) => existing.some((r) => r.departmentId === id)));
    return {
      input: row,
      memberId: person?.id,
      memberName: person?.name,
      resumeSourceId: center?.id,
      row: index + 1,
      ...matched,
      addsCenter: !catalog.assignments.some(
        (a) => a.memberId === person?.id && a.resumeSourceId === center?.id,
      ),
      error,
      nameMismatch: Boolean(
        person && row.name && normalizeScopeName(person.name) !== normalizeScopeName(row.name),
      ),
      status: (error && "invalid") || (duplicate && "existing") || "ready",
    };
  });
}

export function importResponsibilities(
  organizationId: string,
  rows: z.infer<typeof responsibilityInput>[],
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${organizationId}), hashtext('odc-responsibilities'))`,
    );
    const preview = previewResponsibilityRows(
      rows,
      await loadResponsibilityCatalog(organizationId, tx),
    );
    if (preview.some((r) => r.status === "invalid")) {
      return { ok: false as const, preview };
    }
    let added = 0;
    for (const row of preview) {
      if (!row.memberId || !row.resumeSourceId || row.status === "existing") {
        continue;
      }
      await tx
        .insert(resumeSourceOdcMember)
        .values({ memberId: row.memberId, organizationId, resumeSourceId: row.resumeSourceId })
        .onConflictDoNothing();
      const ids = row.allDepartments ? [null] : row.departmentIds;
      for (const departmentId of ids) {
        const inserted = await tx
          .insert(odcDepartmentResponsibility)
          .values({
            departmentId,
            id: randomUUID(),
            memberId: row.memberId,
            organizationId,
            resumeSourceId: row.resumeSourceId,
          })
          .onConflictDoNothing()
          .returning({ id: odcDepartmentResponsibility.id });
        added += inserted.length;
      }
    }
    return { added, ok: true as const, preview };
  });
}

export function saveResponsibility(organizationId: string, input: z.infer<typeof scopeInput>) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${organizationId}), hashtext('odc-responsibilities'))`,
    );
    const catalog = await loadResponsibilityCatalog(organizationId, tx);
    if (
      !catalog.members.some((m) => m.id === input.memberId && m.isOdc) ||
      !catalog.centers.some((c) => c.id === input.resumeSourceId) ||
      input.departmentIds.some(
        (id) =>
          !catalog.departments.some(
            (d) => d.id === id && d.resumeSourceId === input.resumeSourceId,
          ),
      )
    ) {
      return false;
    }
    await tx
      .insert(resumeSourceOdcMember)
      .values({ memberId: input.memberId, organizationId, resumeSourceId: input.resumeSourceId })
      .onConflictDoNothing();
    await tx
      .delete(odcDepartmentResponsibility)
      .where(
        and(
          eq(odcDepartmentResponsibility.organizationId, organizationId),
          eq(odcDepartmentResponsibility.memberId, input.memberId),
          eq(odcDepartmentResponsibility.resumeSourceId, input.resumeSourceId),
        ),
      );
    const ids = input.allDepartments ? [null] : [...new Set(input.departmentIds)];
    if (ids.length) {
      await tx.insert(odcDepartmentResponsibility).values(
        ids.map((departmentId) => ({
          departmentId,
          id: randomUUID(),
          memberId: input.memberId,
          organizationId,
          resumeSourceId: input.resumeSourceId,
        })),
      );
    }
    return true;
  });
}
