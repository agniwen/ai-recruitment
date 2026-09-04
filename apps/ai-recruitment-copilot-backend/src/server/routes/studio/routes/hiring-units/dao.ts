import type {
  HiringUnitListRecord,
  HiringUnitRecord,
  HiringUnitTreeDepartment,
  HiringUnitTreeResult,
  OdcMemberSummary,
} from "@arc/shared/hiring-units";
import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
import { department, hiringUnit, member, user } from "@arc/db-schema/schema";
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

const hiringUnitOdcMember = alias(member, "hiring_unit_odc_member");
const hiringUnitOdcUser = alias(user, "hiring_unit_odc_user");
const departmentOdcMember = alias(member, "department_odc_member");
const departmentOdcUser = alias(user, "department_odc_user");

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
  email: string | null;
  image: string | null;
  memberId: string | null;
  name: string | null;
  userId: string | null;
}): OdcMemberSummary | null {
  if (!(row.email && row.memberId && row.name && row.userId)) {
    return null;
  }
  return {
    email: row.email,
    image: row.image,
    memberId: row.memberId,
    name: row.name,
    userId: row.userId,
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
  const [unitRows, departmentRows] = await Promise.all([
    db
      .select({
        createdAt: hiringUnit.createdAt,
        createdBy: hiringUnit.createdBy,
        description: hiringUnit.description,
        id: hiringUnit.id,
        name: hiringUnit.name,
        odcEmail: hiringUnitOdcUser.email,
        odcImage: hiringUnitOdcUser.image,
        odcMemberId: hiringUnitOdcMember.id,
        odcName: hiringUnitOdcUser.name,
        odcUserId: hiringUnitOdcUser.id,
        updatedAt: hiringUnit.updatedAt,
      })
      .from(hiringUnit)
      .leftJoin(hiringUnitOdcMember, eq(hiringUnit.odcMemberId, hiringUnitOdcMember.id))
      .leftJoin(hiringUnitOdcUser, eq(hiringUnitOdcMember.userId, hiringUnitOdcUser.id))
      .where(eq(hiringUnit.organizationId, organizationId))
      .orderBy(asc(hiringUnit.name)),
    db
      .select({
        createdAt: department.createdAt,
        description: department.description,
        hiringUnitId: department.hiringUnitId,
        id: department.id,
        name: department.name,
        odcEmail: departmentOdcUser.email,
        odcImage: departmentOdcUser.image,
        odcMemberId: departmentOdcMember.id,
        odcName: departmentOdcUser.name,
        odcUserId: departmentOdcUser.id,
        updatedAt: department.updatedAt,
      })
      .from(department)
      .leftJoin(departmentOdcMember, eq(department.odcMemberId, departmentOdcMember.id))
      .leftJoin(departmentOdcUser, eq(departmentOdcMember.userId, departmentOdcUser.id))
      .where(and(eq(department.organizationId, organizationId), departmentScopeCondition))
      .orderBy(asc(department.name)),
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
      odcMember: toOdcMemberSummary({
        email: row.odcEmail,
        image: row.odcImage,
        memberId: row.odcMemberId,
        name: row.odcName,
        userId: row.odcUserId,
      }),
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
      odcMember: toOdcMemberSummary({
        email: row.odcEmail,
        image: row.odcImage,
        memberId: row.odcMemberId,
        name: row.odcName,
        userId: row.odcUserId,
      }),
      updatedAt: serializeDate(row.updatedAt),
    })),
    unassignedDepartments,
  };
}

export async function updateHiringUnitOdcMember({
  id,
  memberId,
  organizationId,
}: {
  id: string;
  memberId: string | null;
  organizationId: string;
}): Promise<boolean> {
  const rows = await db
    .update(hiringUnit)
    .set({ odcMemberId: memberId, updatedAt: new Date() })
    .where(and(eq(hiringUnit.id, id), eq(hiringUnit.organizationId, organizationId)))
    .returning({ id: hiringUnit.id });
  return rows.length > 0;
}
