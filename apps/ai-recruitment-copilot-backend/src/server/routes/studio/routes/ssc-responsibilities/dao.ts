import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, sscResponsibility, user } from "@arc/db-schema/schema";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import type { SscResponsibilitiesQuery, SscResponsibilityInput } from "./schema";

const UNIQUE_RELATIONSHIP_CONSTRAINTS = new Set([
  "ssc_responsibility_workspace_center_identity_uq",
  "ssc_responsibility_workspace_center_email_uq",
]);

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

function duplicateError(error: unknown): boolean {
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
    pattern
      ? or(
          ilike(sscResponsibility.centerName, pattern),
          ilike(sscResponsibility.demandOwner, pattern),
          ilike(sscResponsibility.email, pattern),
          ilike(sscResponsibility.notes, pattern),
          ilike(sscResponsibility.sscName, pattern),
          ilike(sscResponsibility.telegram, pattern),
        )
      : undefined,
  );
  const column = sscResponsibility[query.sortBy];
  const order = query.sortOrder === "desc" ? desc(column) : asc(column);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        centerName: sscResponsibility.centerName,
        createdAt: sscResponsibility.createdAt,
        demandOwner: sscResponsibility.demandOwner,
        email: sscResponsibility.email,
        id: sscResponsibility.id,
        notes: sscResponsibility.notes,
        sscName: sscResponsibility.sscName,
        telegram: sscResponsibility.telegram,
        updatedAt: sscResponsibility.updatedAt,
      })
      .from(sscResponsibility)
      .where(where)
      .orderBy(order, asc(sscResponsibility.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(sscResponsibility).where(where),
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
): Promise<{ id: string } | "duplicate"> {
  try {
    const [created] = await db
      .insert(sscResponsibility)
      .values({ ...input, id: randomUUID(), organizationId })
      .returning({ id: sscResponsibility.id });
    return created;
  } catch (error) {
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
): Promise<{ id: string } | "duplicate" | "not_found"> {
  try {
    const [updated] = await db
      .update(sscResponsibility)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(eq(sscResponsibility.id, id), eq(sscResponsibility.organizationId, organizationId)),
      )
      .returning({ id: sscResponsibility.id });
    return updated ?? "not_found";
  } catch (error) {
    if (duplicateError(error)) {
      return "duplicate" as const;
    }
    throw error;
  }
}

export async function deleteSscResponsibility(organizationId: string, id: string) {
  const deleted = await db
    .delete(sscResponsibility)
    .where(and(eq(sscResponsibility.id, id), eq(sscResponsibility.organizationId, organizationId)))
    .returning({ id: sscResponsibility.id });
  return deleted.length > 0;
}
