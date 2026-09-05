import { buildListTextFilterWhere } from "@arc/ai-recruitment-copilot-backend/lib/server/db/list-text-filters";
import { listTextFiltersSchema } from "@arc/shared/list-text-filters";
import type { DepartmentListRecord, DepartmentRecord } from "@arc/shared/departments";
import type { SQL } from "drizzle-orm";
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
  interviewer,
  jobDescription,
  member,
  user,
} from "@arc/db-schema/schema";
import { resolveDepartmentHiringUnitScopeCondition } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import type { OdcMemberSummary } from "@arc/shared/hiring-units";

const departmentListFiltersSchema = z.object({
  search: z.string().trim().max(120).optional().nullable(),
  textFilters: listTextFiltersSchema("departments"),
});

const SORT_COLUMNS = ["createdAt", "name", "updatedAt"] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];

const ORDER_COLUMNS = {
  createdAt: department.createdAt,
  name: department.name,
  updatedAt: department.updatedAt,
} as const;

const departmentPaginationSchema = makePaginationSchema(SORT_COLUMNS);

export type DepartmentPaginationParams = PaginationParams<SortColumn>;

export type PaginatedDepartmentResult = PaginatedResult<DepartmentListRecord>;

const DEPARTMENT_ID_QUERY_BATCH_SIZE = 5000;

export async function areDepartmentsVisible({
  actorUserId,
  ids,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  ids: string[];
  organizationId: string;
}): Promise<boolean> {
  if (ids.length === 0) {
    return true;
  }
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId,
    organizationId,
  });
  let visibleCount = 0;
  for (let index = 0; index < ids.length; index += DEPARTMENT_ID_QUERY_BATCH_SIZE) {
    const rows = await db
      .select({ id: department.id })
      .from(department)
      .where(
        and(
          eq(department.organizationId, organizationId),
          inArray(department.id, ids.slice(index, index + DEPARTMENT_ID_QUERY_BATCH_SIZE)),
          scopeCondition,
        ),
      );
    visibleCount += rows.length;
  }
  return visibleCount === ids.length;
}

function buildWhereConditions({
  organizationId,
  textFilters,
  search,
  scopeCondition,
}: {
  organizationId: string;
  textFilters?: string;
  search?: string;
  scopeCondition?: SQL;
}) {
  const conditions: SQL[] = [eq(department.organizationId, organizationId)];
  if (search) {
    const searchCondition = or(
      ilike(department.name, `%${search}%`),
      ilike(department.description, `%${search}%`),
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  const atomic = buildListTextFilterWhere("departments", textFilters, {
    description: department.description,
    name: department.name,
  });
  if (atomic) {
    conditions.push(atomic);
  }
  if (scopeCondition) {
    conditions.push(scopeCondition);
  }
  return and(...conditions);
}

function listDepartmentRows({
  organizationId,
  textFilters,
  search,
  sortBy = "createdAt",
  sortOrder = "desc",
  limit,
  offset,
  scopeCondition,
}: {
  organizationId: string;
  textFilters?: string;
  search?: string;
  sortBy?: SortColumn;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
  scopeCondition?: SQL;
}) {
  const where = buildWhereConditions({ organizationId, scopeCondition, search, textFilters });

  let query = db
    .select({
      createdAt: department.createdAt,
      createdBy: department.createdBy,
      description: department.description,
      hiringUnitId: department.hiringUnitId,
      hiringUnitName: hiringUnit.name,
      id: department.id,
      name: department.name,
      updatedAt: department.updatedAt,
    })
    .from(department)
    .leftJoin(hiringUnit, eq(department.hiringUnitId, hiringUnit.id))
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

async function countDepartmentRows({
  organizationId,
  textFilters,
  search,
  scopeCondition,
}: {
  organizationId: string;
  textFilters?: string;
  search?: string;
  scopeCondition?: SQL;
}) {
  const where = buildWhereConditions({ organizationId, scopeCondition, search, textFilters });
  const [result] = await db.select({ count: count() }).from(department).where(where);
  return result?.count ?? 0;
}

export async function loadDepartmentReferenceCountsByIds(departmentIds: string[]) {
  if (departmentIds.length === 0) {
    return new Map<string, { interviewerCount: number; jobDescriptionCount: number }>();
  }

  const [interviewerRows, jobDescriptionRows] = await Promise.all([
    db
      .select({
        count: count(),
        departmentId: interviewer.departmentId,
      })
      .from(interviewer)
      .where(inArray(interviewer.departmentId, departmentIds))
      .groupBy(interviewer.departmentId),
    db
      .select({
        count: count(),
        departmentId: jobDescription.departmentId,
      })
      .from(jobDescription)
      .where(inArray(jobDescription.departmentId, departmentIds))
      .groupBy(jobDescription.departmentId),
  ]);

  const map = new Map<string, { interviewerCount: number; jobDescriptionCount: number }>();
  for (const id of departmentIds) {
    map.set(id, { interviewerCount: 0, jobDescriptionCount: 0 });
  }
  for (const row of interviewerRows) {
    const entry = map.get(row.departmentId);
    if (entry) {
      entry.interviewerCount = row.count;
    }
  }
  for (const row of jobDescriptionRows) {
    const entry = map.get(row.departmentId);
    if (entry) {
      entry.jobDescriptionCount = row.count;
    }
  }

  return map;
}

export async function loadDepartmentOdcMembersByIds({
  departmentIds,
  organizationId,
}: {
  departmentIds: string[];
  organizationId: string;
}): Promise<Map<string, OdcMemberSummary[]>> {
  if (departmentIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      departmentId: departmentOdcMember.departmentId,
      email: user.email,
      image: user.image,
      memberId: member.id,
      name: user.name,
      userId: user.id,
    })
    .from(departmentOdcMember)
    .innerJoin(member, eq(departmentOdcMember.memberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(departmentOdcMember.organizationId, organizationId),
        inArray(departmentOdcMember.departmentId, departmentIds),
      ),
    )
    .orderBy(user.name, user.email);

  const membersByDepartmentId = new Map<string, OdcMemberSummary[]>();
  for (const row of rows) {
    const records = membersByDepartmentId.get(row.departmentId) ?? [];
    records.push({
      email: row.email,
      image: row.image,
      memberId: row.memberId,
      name: row.name,
      userId: row.userId,
    });
    membersByDepartmentId.set(row.departmentId, records);
  }
  return membersByDepartmentId;
}

function toDepartmentListRecord(
  row: Awaited<ReturnType<typeof listDepartmentRows>>[number],
  refs: { interviewerCount: number; jobDescriptionCount: number },
  odcMembers: OdcMemberSummary[],
): DepartmentListRecord {
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    description: row.description,
    hiringUnitId: row.hiringUnitId,
    hiringUnitName: row.hiringUnitName,
    id: row.id,
    interviewerCount: refs.interviewerCount,
    jobDescriptionCount: refs.jobDescriptionCount,
    name: row.name,
    odcMembers,
    updatedAt: serializeDate(row.updatedAt),
  };
}

function parseFilters(filters?: { textFilters?: string; search?: string | null }) {
  const parsed = departmentListFiltersSchema.safeParse(filters ?? {});
  if (!parsed.success) {
    return { search: undefined, textFilters: undefined };
  }
  return { search: parsed.data.search?.trim() || undefined, textFilters: parsed.data.textFilters };
}

export function parseDepartmentPagination(
  params?: Record<string, unknown>,
): DepartmentPaginationParams {
  return departmentPaginationSchema.parse(params ?? {});
}

export async function queryPaginatedDepartments(
  filters: {
    organizationId: string;
    textFilters?: string;
    search?: string | null;
    actorUserId?: string | null;
  },
  pagination?: Record<string, unknown>,
): Promise<PaginatedDepartmentResult> {
  const { textFilters, search } = parseFilters(filters);
  const { organizationId } = filters;
  const { page, pageSize, sortBy, sortOrder } = parseDepartmentPagination(pagination);
  const offset = (page - 1) * pageSize;
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId: filters.actorUserId,
    organizationId,
  });

  const [records, total] = await Promise.all([
    listDepartmentRows({
      limit: pageSize,
      offset,
      organizationId,
      scopeCondition,
      search,
      sortBy,
      sortOrder,
      textFilters,
    }),
    countDepartmentRows({ organizationId, scopeCondition, search, textFilters }),
  ]);

  const departmentIds = records.map((record) => record.id);
  const [refsMap, odcMembersByDepartmentId] = await Promise.all([
    loadDepartmentReferenceCountsByIds(departmentIds),
    loadDepartmentOdcMembersByIds({ departmentIds, organizationId }),
  ]);

  return {
    page,
    pageSize,
    records: records.map((record) =>
      toDepartmentListRecord(
        record,
        refsMap.get(record.id) ?? { interviewerCount: 0, jobDescriptionCount: 0 },
        odcMembersByDepartmentId.get(record.id) ?? [],
      ),
    ),
    total,
    totalPages: calcTotalPages(total, pageSize),
  };
}

export function listDepartments(
  filters: {
    organizationId: string;
    textFilters?: string;
    search?: string | null;
    actorUserId?: string | null;
  },
  pagination?: Record<string, unknown>,
) {
  return queryPaginatedDepartments(filters, pagination);
}

/** Load all departments (small list, used for selects). */
export async function listAllDepartments(
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<DepartmentRecord[]> {
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    organizationId,
  });
  const where = buildWhereConditions({ organizationId, scopeCondition });
  const rows = await db
    .select({
      createdAt: department.createdAt,
      createdBy: department.createdBy,
      description: department.description,
      hiringUnitId: department.hiringUnitId,
      hiringUnitName: hiringUnit.name,
      id: department.id,
      name: department.name,
      updatedAt: department.updatedAt,
    })
    .from(department)
    .leftJoin(hiringUnit, eq(department.hiringUnitId, hiringUnit.id))
    .where(where)
    .orderBy(asc(department.name));
  return rows.map((row) => ({
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    description: row.description,
    hiringUnitId: row.hiringUnitId,
    hiringUnitName: row.hiringUnitName,
    id: row.id,
    name: row.name,
    updatedAt: serializeDate(row.updatedAt),
  }));
}

export async function loadDepartmentReferenceCounts(id: string) {
  const [interviewerCountResult, jobDescriptionCountResult] = await Promise.all([
    db.select({ count: count() }).from(interviewer).where(eq(interviewer.departmentId, id)),
    db.select({ count: count() }).from(jobDescription).where(eq(jobDescription.departmentId, id)),
  ]);

  return {
    interviewerCount: interviewerCountResult[0]?.count ?? 0,
    jobDescriptionCount: jobDescriptionCountResult[0]?.count ?? 0,
  };
}

export function replaceDepartmentOdcMembers({
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
      .update(department)
      .set({ updatedAt: new Date() })
      .where(and(eq(department.id, id), eq(department.organizationId, organizationId)))
      .returning({ id: department.id });
    if (rows.length === 0) {
      return false;
    }

    await tx
      .delete(departmentOdcMember)
      .where(
        and(
          eq(departmentOdcMember.departmentId, id),
          eq(departmentOdcMember.organizationId, organizationId),
        ),
      );
    if (memberIds.length > 0) {
      await tx.insert(departmentOdcMember).values(
        memberIds.map((memberId) => ({
          departmentId: id,
          memberId,
          organizationId,
        })),
      );
    }
    return true;
  });
}

export async function loadDepartmentById(
  id: string,
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<DepartmentRecord | null> {
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    organizationId,
  });
  const where = and(
    eq(department.id, id),
    buildWhereConditions({ organizationId, scopeCondition }),
  );
  const [row] = await db
    .select({
      createdAt: department.createdAt,
      createdBy: department.createdBy,
      description: department.description,
      hiringUnitId: department.hiringUnitId,
      hiringUnitName: hiringUnit.name,
      id: department.id,
      name: department.name,
      updatedAt: department.updatedAt,
    })
    .from(department)
    .leftJoin(hiringUnit, eq(department.hiringUnitId, hiringUnit.id))
    .where(where)
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    description: row.description,
    hiringUnitId: row.hiringUnitId,
    hiringUnitName: row.hiringUnitName,
    id: row.id,
    name: row.name,
    updatedAt: serializeDate(row.updatedAt),
  };
}

export function serializeDepartment(row: typeof department.$inferSelect): DepartmentRecord {
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    description: row.description,
    hiringUnitId: row.hiringUnitId,
    hiringUnitName: null,
    id: row.id,
    name: row.name,
    updatedAt: serializeDate(row.updatedAt),
  };
}
