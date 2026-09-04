import type {
  HiringUnitListRecord,
  HiringUnitRecord,
  HiringUnitTreeDepartment,
  HiringUnitTreeResult,
  OdcMemberSummary,
} from "@arc/shared/hiring-units";
import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  buildOrderBy,
  calcTotalPages,
  makePaginationSchema,
} from "@arc/ai-recruitment-copilot-backend/lib/server/db/pagination";
import type {
  PaginatedResult,
  PaginationParams,
} from "@arc/ai-recruitment-copilot-backend/lib/server/db/pagination";
import { serializeDate } from "@arc/ai-recruitment-copilot-backend/lib/server/db/serialize";
import {
  department,
  departmentOdcMember,
  hiringUnit,
  hiringUnitOdcMember,
  member,
  user,
} from "@arc/db-schema/schema";
import {
  resolveDepartmentHiringUnitScopeCondition,
  resolveHiringUnitAccessScope,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";

const hiringUnitListFiltersSchema = z.object({
  search: z.string().trim().max(120).optional().nullable(),
});

const SORT_COLUMNS = ["createdAt", "name", "updatedAt"] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];

const ORDER_COLUMNS = {
  createdAt: hiringUnit.createdAt,
  name: hiringUnit.name,
  updatedAt: hiringUnit.updatedAt,
} as const;

const hiringUnitPaginationSchema = makePaginationSchema(SORT_COLUMNS);

export type HiringUnitPaginationParams = PaginationParams<SortColumn>;

export type PaginatedHiringUnitResult = PaginatedResult<HiringUnitListRecord>;

function buildWhereConditions({
  organizationId,
  search,
}: {
  organizationId: string;
  search?: string;
}) {
  const orgFilter = eq(hiringUnit.organizationId, organizationId);
  if (!search) {
    return orgFilter;
  }

  return and(
    orgFilter,
    or(ilike(hiringUnit.name, `%${search}%`), ilike(hiringUnit.description, `%${search}%`)),
  );
}

function listHiringUnitRows({
  organizationId,
  search,
  sortBy = "createdAt",
  sortOrder = "desc",
  limit,
  offset,
}: {
  organizationId: string;
  search?: string;
  sortBy?: SortColumn;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const where = buildWhereConditions({ organizationId, search });

  let query = db
    .select()
    .from(hiringUnit)
    .where(where)
    .orderBy(buildOrderBy(ORDER_COLUMNS, sortBy, sortOrder))
    .$dynamic();

  if (limit !== undefined) {
    query = query.limit(limit);
  }
  if (offset !== undefined) {
    query = query.offset(offset);
  }

  return query;
}

async function countHiringUnitRows({
  organizationId,
  search,
}: {
  organizationId: string;
  search?: string;
}) {
  const where = buildWhereConditions({ organizationId, search });
  const [result] = await db.select({ count: count() }).from(hiringUnit).where(where);
  return result?.count ?? 0;
}

function parseFilters(filters?: { search?: string | null }) {
  const parsed = hiringUnitListFiltersSchema.safeParse(filters ?? {});
  if (!parsed.success) {
    return { search: undefined };
  }
  return { search: parsed.data.search?.trim() || undefined };
}

export function parseHiringUnitPagination(
  params?: Record<string, unknown>,
): HiringUnitPaginationParams {
  return hiringUnitPaginationSchema.parse(params ?? {});
}

export function serializeHiringUnit(row: typeof hiringUnit.$inferSelect): HiringUnitRecord {
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    description: row.description,
    id: row.id,
    name: row.name,
    updatedAt: serializeDate(row.updatedAt),
  };
}

export async function queryPaginatedHiringUnits(
  filters: { organizationId: string; search?: string | null },
  pagination?: Record<string, unknown>,
): Promise<PaginatedHiringUnitResult> {
  const { search } = parseFilters(filters);
  const { organizationId } = filters;
  const { page, pageSize, sortBy, sortOrder } = parseHiringUnitPagination(pagination);
  const offset = (page - 1) * pageSize;

  const [records, total] = await Promise.all([
    listHiringUnitRows({ limit: pageSize, offset, organizationId, search, sortBy, sortOrder }),
    countHiringUnitRows({ organizationId, search }),
  ]);

  return {
    page,
    pageSize,
    records: records.map((record) => serializeHiringUnit(record)),
    total,
    totalPages: calcTotalPages(total, pageSize),
  };
}

export function listHiringUnits(
  filters: { organizationId: string; search?: string | null },
  pagination?: Record<string, unknown>,
) {
  return queryPaginatedHiringUnits(filters, pagination);
}

export async function listAllHiringUnits(organizationId: string): Promise<HiringUnitRecord[]> {
  const rows = await db
    .select()
    .from(hiringUnit)
    .where(eq(hiringUnit.organizationId, organizationId))
    .orderBy(asc(hiringUnit.name));
  return rows.map((row) => serializeHiringUnit(row));
}

export async function listSelectableHiringUnits({
  actorUserId,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  organizationId: string;
}): Promise<HiringUnitRecord[]> {
  const scope = await resolveHiringUnitAccessScope({ actorUserId, organizationId });
  if (scope.canAccessAll) {
    return listAllHiringUnits(organizationId);
  }
  if (scope.hiringUnitIds.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(hiringUnit)
    .where(
      and(
        eq(hiringUnit.organizationId, organizationId),
        inArray(hiringUnit.id, scope.hiringUnitIds),
      ),
    )
    .orderBy(asc(hiringUnit.name));
  return rows.map((row) => serializeHiringUnit(row));
}

export async function loadHiringUnitById(
  id: string,
  organizationId: string,
): Promise<HiringUnitRecord | null> {
  const [row] = await db
    .select()
    .from(hiringUnit)
    .where(and(eq(hiringUnit.id, id), eq(hiringUnit.organizationId, organizationId)))
    .limit(1);
  return row ? serializeHiringUnit(row) : null;
}

function toOdcMemberSummary(row: {
  email: string;
  image: string | null;
  memberId: string;
  name: string;
  userId: string;
}): OdcMemberSummary {
  return {
    email: row.email,
    image: row.image,
    memberId: row.memberId,
    name: row.name,
    userId: row.userId,
  };
}

async function loadOdcMembersByTarget(organizationId: string) {
  const [hiringUnitRows, departmentRows] = await Promise.all([
    db
      .select({
        email: user.email,
        image: user.image,
        memberId: member.id,
        name: user.name,
        targetId: hiringUnitOdcMember.hiringUnitId,
        userId: user.id,
      })
      .from(hiringUnitOdcMember)
      .innerJoin(member, eq(hiringUnitOdcMember.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(hiringUnitOdcMember.organizationId, organizationId))
      .orderBy(asc(user.name), asc(user.email)),
    db
      .select({
        email: user.email,
        image: user.image,
        memberId: member.id,
        name: user.name,
        targetId: departmentOdcMember.departmentId,
        userId: user.id,
      })
      .from(departmentOdcMember)
      .innerJoin(member, eq(departmentOdcMember.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(departmentOdcMember.organizationId, organizationId))
      .orderBy(asc(user.name), asc(user.email)),
  ]);

  const groupRows = (
    rows: (OdcMemberSummary & {
      targetId: string;
    })[],
  ) => {
    const grouped = new Map<string, OdcMemberSummary[]>();
    for (const row of rows) {
      const records = grouped.get(row.targetId) ?? [];
      records.push(toOdcMemberSummary(row));
      grouped.set(row.targetId, records);
    }
    return grouped;
  };

  return {
    departments: groupRows(departmentRows),
    hiringUnits: groupRows(hiringUnitRows),
  };
}

export async function listHiringUnitTree({
  actorUserId,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  organizationId: string;
}): Promise<HiringUnitTreeResult> {
  const departmentScopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId,
    organizationId,
  });
  const [unitRows, departmentRows, odcMembersByTarget] = await Promise.all([
    db
      .select({
        createdAt: hiringUnit.createdAt,
        createdBy: hiringUnit.createdBy,
        description: hiringUnit.description,
        id: hiringUnit.id,
        name: hiringUnit.name,
        updatedAt: hiringUnit.updatedAt,
      })
      .from(hiringUnit)
      .where(eq(hiringUnit.organizationId, organizationId))
      .orderBy(asc(hiringUnit.name)),
    db
      .select({
        createdAt: department.createdAt,
        description: department.description,
        hiringUnitId: department.hiringUnitId,
        id: department.id,
        name: department.name,
        updatedAt: department.updatedAt,
      })
      .from(department)
      .where(and(eq(department.organizationId, organizationId), departmentScopeCondition))
      .orderBy(asc(department.name)),
    loadOdcMembersByTarget(organizationId),
  ]);

  const departmentsByHiringUnitId = new Map<string, HiringUnitTreeDepartment[]>();
  const unassignedDepartments: HiringUnitTreeDepartment[] = [];
  for (const row of departmentRows) {
    const record: HiringUnitTreeDepartment = {
      createdAt: serializeDate(row.createdAt),
      description: row.description,
      hiringUnitId: row.hiringUnitId,
      id: row.id,
      name: row.name,
      odcMembers: odcMembersByTarget.departments.get(row.id) ?? [],
      updatedAt: serializeDate(row.updatedAt),
    };
    if (!row.hiringUnitId) {
      unassignedDepartments.push(record);
      continue;
    }
    const records = departmentsByHiringUnitId.get(row.hiringUnitId) ?? [];
    records.push(record);
    departmentsByHiringUnitId.set(row.hiringUnitId, records);
  }

  return {
    records: unitRows.map((row) => ({
      createdAt: serializeDate(row.createdAt),
      createdBy: row.createdBy,
      departments: departmentsByHiringUnitId.get(row.id) ?? [],
      description: row.description,
      id: row.id,
      name: row.name,
      odcMembers: odcMembersByTarget.hiringUnits.get(row.id) ?? [],
      updatedAt: serializeDate(row.updatedAt),
    })),
    unassignedDepartments,
  };
}

export function replaceHiringUnitOdcMembers({
  id,
  memberIds,
  organizationId,
}: {
  id: string;
  memberIds: string[];
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(hiringUnit)
      .set({ updatedAt: new Date() })
      .where(and(eq(hiringUnit.id, id), eq(hiringUnit.organizationId, organizationId)))
      .returning({ id: hiringUnit.id });
    if (rows.length === 0) {
      return false;
    }

    await tx
      .delete(hiringUnitOdcMember)
      .where(
        and(
          eq(hiringUnitOdcMember.hiringUnitId, id),
          eq(hiringUnitOdcMember.organizationId, organizationId),
        ),
      );
    if (memberIds.length > 0) {
      await tx.insert(hiringUnitOdcMember).values(
        memberIds.map((memberId) => ({
          hiringUnitId: id,
          memberId,
          organizationId,
        })),
      );
    }
    return true;
  });
}
