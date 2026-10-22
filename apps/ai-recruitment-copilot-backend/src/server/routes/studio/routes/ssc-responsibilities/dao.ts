import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { syncSscMemberRole } from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import {
  department,
  hiringUnit,
  jobDescription,
  member,
  organizationRole,
  resumeSource,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import type { SscResponsibilitiesQuery, SscResponsibilityInput } from "./schema";

const UNIQUE_RELATIONSHIP_CONSTRAINTS = new Set([
  "ssc_responsibility_workspace_scope_identity_uq",
  "ssc_responsibility_workspace_center_identity_uq",
  "ssc_responsibility_workspace_center_email_uq",
]);

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SaveValidationError =
  | "invalid_role"
  | "invalid_source"
  | "invalid_department"
  | "role_conflict";

class SscRoleConflictError extends Error {
  override name = "SscRoleConflictError";
}

const NON_SSC_ROLE_KEYS = ["owner", "admin", "member", "noAccess"];

export async function listSscResponsibilityOptions(organizationId: string) {
  const [roles, resumeSources, departments, serviceUnits] = await Promise.all([
    db
      .select({ label: organizationRole.name, value: organizationRole.role })
      .from(organizationRole)
      .where(
        and(
          eq(organizationRole.organizationId, organizationId),
          eq(organizationRole.isSsc, true),
          notInArray(organizationRole.role, NON_SSC_ROLE_KEYS),
        ),
      )
      .orderBy(asc(organizationRole.name), asc(organizationRole.role)),
    db
      .select({ id: resumeSource.id, name: resumeSource.name })
      .from(resumeSource)
      .where(eq(resumeSource.organizationId, organizationId))
      .orderBy(asc(resumeSource.name), asc(resumeSource.id)),
    db
      .select({ hiringUnitName: hiringUnit.name, id: department.id, name: department.name })
      .from(department)
      .leftJoin(
        hiringUnit,
        and(
          eq(hiringUnit.id, department.hiringUnitId),
          eq(hiringUnit.organizationId, department.organizationId),
        ),
      )
      .where(eq(department.organizationId, organizationId))
      .orderBy(asc(department.name), asc(department.id)),
    db
      .select({ value: sql<string>`min(btrim(${jobDescription.serviceUnit}))` })
      .from(jobDescription)
      .where(
        and(
          eq(jobDescription.organizationId, organizationId),
          sql`nullif(btrim(${jobDescription.serviceUnit}), '') IS NOT NULL`,
        ),
      )
      .groupBy(sql`lower(btrim(${jobDescription.serviceUnit}))`)
      .orderBy(sql`lower(btrim(${jobDescription.serviceUnit}))`),
  ]);
  return {
    departments,
    resumeSources,
    roles,
    serviceUnits: serviceUnits.map((entry) => entry.value),
  };
}

async function lockSscWrites(tx: Transaction, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ssc-responsibilities:${organizationId}`}, 0))`,
  );
}

async function validateAssignment(
  tx: Transaction,
  organizationId: string,
  input: SscResponsibilityInput,
  current?: { centerName: string; id: string; resumeSourceId: string | null },
): Promise<{ centerName: string } | SaveValidationError> {
  if (NON_SSC_ROLE_KEYS.includes(input.workspaceRole)) {
    return "invalid_role";
  }
  const [role] = await tx
    .select({ role: organizationRole.role })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.role, input.workspaceRole),
        eq(organizationRole.isSsc, true),
      ),
    )
    .for("share");
  if (!role) {
    return "invalid_role";
  }

  let { centerName } = input;
  if (input.resumeSourceId) {
    const [source] = await tx
      .select({ name: resumeSource.name })
      .from(resumeSource)
      .where(
        and(
          eq(resumeSource.organizationId, organizationId),
          eq(resumeSource.id, input.resumeSourceId),
        ),
      )
      .for("share");
    if (!source) {
      return "invalid_source";
    }
    centerName = source.name;
  } else if (!current || current.resumeSourceId !== null || current.centerName !== centerName) {
    return "invalid_source";
  }

  if (input.departmentId) {
    const [selected] = await tx
      .select({ id: department.id })
      .from(department)
      .where(
        and(eq(department.id, input.departmentId), eq(department.organizationId, organizationId)),
      )
      .for("share");
    if (!selected) {
      return "invalid_department";
    }
  }

  if (input.email) {
    const [conflict] = await tx
      .select({ id: sscResponsibility.id })
      .from(sscResponsibility)
      .where(
        and(
          eq(sscResponsibility.organizationId, organizationId),
          sql`lower(btrim(${sscResponsibility.email})) = ${input.email}`,
          ne(sscResponsibility.workspaceRole, input.workspaceRole),
          current ? ne(sscResponsibility.id, current.id) : undefined,
        ),
      )
      .limit(1);
    if (conflict) {
      return "role_conflict";
    }
  }
  return { centerName };
}

async function syncSavedRole(
  tx: Transaction,
  organizationId: string,
  input: SscResponsibilityInput,
) {
  const result = await syncSscMemberRole(tx, {
    allowExistingRoleUpdate: true,
    email: input.email,
    organizationId,
    workspaceRole: input.workspaceRole,
  });
  if (result.status === "role_conflict") {
    throw new SscRoleConflictError();
  }
}

export async function loadSscResponsibilityAdministrator(organizationId: string, userId: string) {
  const [record] = await db
    .select({ membership: member })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, userId),
        eq(user.banned, false),
      ),
    )
    .limit(1);
  return record && isWorkspaceAdministratorRole(record.membership.role) ? record.membership : null;
}

export function duplicateError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (
    "code" in error &&
    error.code === "23505" &&
    (("constraint_name" in error &&
      typeof error.constraint_name === "string" &&
      UNIQUE_RELATIONSHIP_CONSTRAINTS.has(error.constraint_name)) ||
      ("constraint" in error &&
        typeof error.constraint === "string" &&
        UNIQUE_RELATIONSHIP_CONSTRAINTS.has(error.constraint)))
  ) {
    return true;
  }
  return "cause" in error && error.cause !== error && duplicateError(error.cause);
}

export async function queryPaginatedSscResponsibilities(
  organizationId: string,
  query: SscResponsibilitiesQuery,
) {
  const search = query.search?.trim();
  const pattern = search
    ? `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : null;
  const where = and(
    eq(sscResponsibility.organizationId, organizationId),
    query.resumeSourceId ? eq(sscResponsibility.resumeSourceId, query.resumeSourceId) : undefined,
    pattern
      ? or(
          ilike(sscResponsibility.centerName, pattern),
          ilike(resumeSource.name, pattern),
          ilike(sscResponsibility.demandOwner, pattern),
          ilike(department.name, pattern),
          ilike(sscResponsibility.email, pattern),
          ilike(sscResponsibility.notes, pattern),
          ilike(sscResponsibility.serviceUnit, pattern),
          ilike(sscResponsibility.sscName, pattern),
          ilike(sscResponsibility.telegram, pattern),
        )
      : undefined,
  );
  const sourceJoin = and(
    eq(resumeSource.organizationId, sscResponsibility.organizationId),
    eq(resumeSource.id, sscResponsibility.resumeSourceId),
  );
  const column =
    query.sortBy === "centerName"
      ? sql<string>`coalesce(${resumeSource.name}, ${sscResponsibility.centerName})`
      : sscResponsibility[query.sortBy];
  const order = query.sortOrder === "desc" ? desc(column) : asc(column);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        centerName: sscResponsibility.centerName,
        createdAt: sscResponsibility.createdAt,
        demandOwner: sscResponsibility.demandOwner,
        departmentId: sscResponsibility.departmentId,
        departmentName: department.name,
        email: sscResponsibility.email,
        id: sscResponsibility.id,
        notes: sscResponsibility.notes,
        resumeSourceId: sscResponsibility.resumeSourceId,
        resumeSourceName: resumeSource.name,
        serviceUnit: sscResponsibility.serviceUnit,
        sscName: sscResponsibility.sscName,
        telegram: sscResponsibility.telegram,
        updatedAt: sscResponsibility.updatedAt,
        workspaceRole: sscResponsibility.workspaceRole,
        workspaceRoleName: organizationRole.name,
      })
      .from(sscResponsibility)
      .leftJoin(resumeSource, sourceJoin)
      .leftJoin(
        department,
        and(
          eq(department.id, sscResponsibility.departmentId),
          eq(department.organizationId, sscResponsibility.organizationId),
        ),
      )
      .leftJoin(
        organizationRole,
        and(
          eq(organizationRole.organizationId, sscResponsibility.organizationId),
          eq(organizationRole.role, sscResponsibility.workspaceRole),
        ),
      )
      .where(where)
      .orderBy(order, asc(sscResponsibility.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(sscResponsibility)
      .leftJoin(resumeSource, sourceJoin)
      .leftJoin(
        department,
        and(
          eq(department.id, sscResponsibility.departmentId),
          eq(department.organizationId, sscResponsibility.organizationId),
        ),
      )
      .where(where),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    records: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function createSscResponsibility(
  organizationId: string,
  input: SscResponsibilityInput,
): Promise<{ id: string } | "duplicate" | SaveValidationError> {
  try {
    return await db.transaction(async (tx) => {
      await lockSscWrites(tx, organizationId);
      const validated = await validateAssignment(tx, organizationId, input);
      if (typeof validated === "string") {
        return validated;
      }
      const [created] = await tx
        .insert(sscResponsibility)
        .values({
          ...input,
          ...validated,
          departmentId: input.departmentId ?? null,
          id: randomUUID(),
          organizationId,
          serviceUnit: input.serviceUnit ?? null,
        })
        .returning({ id: sscResponsibility.id });
      await syncSavedRole(tx, organizationId, input);
      return created;
    });
  } catch (error) {
    if (error instanceof SscRoleConflictError) {
      return "role_conflict";
    }
    if (duplicateError(error)) {
      return "duplicate" as const;
    }
    throw error;
  }
}

export async function updateSscResponsibility(
  organizationId: string,
  id: string,
  input: SscResponsibilityInput,
): Promise<{ id: string } | "duplicate" | "not_found" | SaveValidationError> {
  try {
    return await db.transaction(async (tx) => {
      await lockSscWrites(tx, organizationId);
      const [current] = await tx
        .select({
          centerName: sscResponsibility.centerName,
          departmentId: sscResponsibility.departmentId,
          id: sscResponsibility.id,
          resumeSourceId: sscResponsibility.resumeSourceId,
          serviceUnit: sscResponsibility.serviceUnit,
        })
        .from(sscResponsibility)
        .where(
          and(eq(sscResponsibility.id, id), eq(sscResponsibility.organizationId, organizationId)),
        )
        .for("update");
      if (!current) {
        return "not_found";
      }
      const scopedInput = {
        ...input,
        departmentId: input.departmentId === undefined ? current.departmentId : input.departmentId,
        serviceUnit: input.serviceUnit === undefined ? current.serviceUnit : input.serviceUnit,
      };
      const validated = await validateAssignment(tx, organizationId, scopedInput, current);
      if (typeof validated === "string") {
        return validated;
      }
      const [updated] = await tx
        .update(sscResponsibility)
        .set({ ...scopedInput, ...validated, updatedAt: new Date() })
        .where(
          and(eq(sscResponsibility.id, id), eq(sscResponsibility.organizationId, organizationId)),
        )
        .returning({ id: sscResponsibility.id });
      await syncSavedRole(tx, organizationId, input);
      return updated;
    });
  } catch (error) {
    if (error instanceof SscRoleConflictError) {
      return "role_conflict";
    }
    if (duplicateError(error)) {
      return "duplicate" as const;
    }
    throw error;
  }
}

export function deleteSscResponsibility(organizationId: string, id: string) {
  return db.transaction(async (tx) => {
    await lockSscWrites(tx, organizationId);
    const deleted = await tx
      .delete(sscResponsibility)
      .where(
        and(eq(sscResponsibility.id, id), eq(sscResponsibility.organizationId, organizationId)),
      )
      .returning({ id: sscResponsibility.id });
    return deleted.length > 0;
  });
}
