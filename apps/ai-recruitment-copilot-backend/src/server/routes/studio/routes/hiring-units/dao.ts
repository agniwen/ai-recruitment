import type {
  HiringUnitListRecord,
  HiringUnitRecord,
  HiringUnitTreeDepartment,
  HiringUnitTreeResult,
  OdcAssignmentItem,
  OdcAssignmentSummary,
  OdcBatchAssignmentTarget,
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
import { loadDepartmentReferenceCountsByIds } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";

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

const ODC_ASSIGNMENT_INSERT_BATCH_SIZE = 5000;
const ODC_TARGET_QUERY_BATCH_SIZE = 5000;

function* buildOdcAssignmentBatches<T>(
  targetIds: string[],
  assignments: OdcAssignmentItem[],
  createAssignment: (targetId: string, assignment: OdcAssignmentItem) => T,
): Generator<T[]> {
  let batch: T[] = [];
  for (const targetId of targetIds) {
    for (const assignment of assignments) {
      batch.push(createAssignment(targetId, assignment));
      if (batch.length === ODC_ASSIGNMENT_INSERT_BATCH_SIZE) {
        yield batch;
        batch = [];
      }
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

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

function toOdcAssignmentSummary(row: {
  email: string;
  image: string | null;
  jobSeries: "直属" | "派驻" | null;
  memberId: string;
  name: string;
  serviceUnit: string | null;
  userId: string;
}): OdcAssignmentSummary {
  return {
    email: row.email,
    image: row.image,
    jobSeries: row.jobSeries,
    memberId: row.memberId,
    name: row.name,
    serviceUnit: row.serviceUnit,
    userId: row.userId,
  };
}

async function loadOdcMembersByTarget(organizationId: string) {
  const [hiringUnitRows, departmentRows] = await Promise.all([
    db
      .select({
        email: user.email,
        image: user.image,
        jobSeries: hiringUnitOdcMember.jobSeries,
        memberId: member.id,
        name: user.name,
        serviceUnit: hiringUnitOdcMember.serviceUnit,
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
        jobSeries: departmentOdcMember.jobSeries,
        memberId: member.id,
        name: user.name,
        serviceUnit: departmentOdcMember.serviceUnit,
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
    rows: (OdcAssignmentSummary & {
      targetId: string;
    })[],
  ) => {
    const grouped = new Map<string, OdcAssignmentSummary[]>();
    for (const row of rows) {
      const records = grouped.get(row.targetId) ?? [];
      records.push(toOdcAssignmentSummary(row));
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
  const departmentReferenceCounts = await loadDepartmentReferenceCountsByIds(
    departmentRows.map((row) => row.id),
  );

  const departmentsByHiringUnitId = new Map<string, HiringUnitTreeDepartment[]>();
  const unassignedDepartments: HiringUnitTreeDepartment[] = [];
  for (const row of departmentRows) {
    const record: HiringUnitTreeDepartment = {
      createdAt: serializeDate(row.createdAt),
      description: row.description,
      hiringUnitId: row.hiringUnitId,
      id: row.id,
      interviewerCount: departmentReferenceCounts.get(row.id)?.interviewerCount ?? 0,
      jobDescriptionCount: departmentReferenceCounts.get(row.id)?.jobDescriptionCount ?? 0,
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

export function replaceOdcMembersForTargets({
  assignments,
  organizationId,
  targets,
}: {
  assignments: OdcAssignmentItem[];
  organizationId: string;
  targets: OdcBatchAssignmentTarget[];
}): Promise<boolean> {
  const hiringUnitIds = targets
    .filter((target) => target.rowType === "hiringUnit")
    .map((target) => target.id);
  const departmentIds = targets
    .filter((target) => target.rowType === "department")
    .map((target) => target.id);

  return db.transaction(async (tx) => {
    const existingHiringUnits = [];
    for (let index = 0; index < hiringUnitIds.length; index += ODC_TARGET_QUERY_BATCH_SIZE) {
      const rows = await tx
        .select({ id: hiringUnit.id })
        .from(hiringUnit)
        .where(
          and(
            eq(hiringUnit.organizationId, organizationId),
            inArray(hiringUnit.id, hiringUnitIds.slice(index, index + ODC_TARGET_QUERY_BATCH_SIZE)),
          ),
        );
      existingHiringUnits.push(...rows);
    }
    const existingDepartments = [];
    for (let index = 0; index < departmentIds.length; index += ODC_TARGET_QUERY_BATCH_SIZE) {
      const rows = await tx
        .select({ id: department.id })
        .from(department)
        .where(
          and(
            eq(department.organizationId, organizationId),
            inArray(department.id, departmentIds.slice(index, index + ODC_TARGET_QUERY_BATCH_SIZE)),
          ),
        );
      existingDepartments.push(...rows);
    }
    if (
      existingHiringUnits.length !== hiringUnitIds.length ||
      existingDepartments.length !== departmentIds.length
    ) {
      return false;
    }

    const now = new Date();
    if (hiringUnitIds.length > 0) {
      for (let index = 0; index < hiringUnitIds.length; index += ODC_TARGET_QUERY_BATCH_SIZE) {
        const idBatch = hiringUnitIds.slice(index, index + ODC_TARGET_QUERY_BATCH_SIZE);
        await tx
          .update(hiringUnit)
          .set({ updatedAt: now })
          .where(
            and(eq(hiringUnit.organizationId, organizationId), inArray(hiringUnit.id, idBatch)),
          );
        await tx
          .delete(hiringUnitOdcMember)
          .where(
            and(
              eq(hiringUnitOdcMember.organizationId, organizationId),
              inArray(hiringUnitOdcMember.hiringUnitId, idBatch),
            ),
          );
      }
      if (assignments.length > 0) {
        for (const assignmentBatch of buildOdcAssignmentBatches(
          hiringUnitIds,
          assignments,
          (hiringUnitId, assignment) => ({
            hiringUnitId,
            jobSeries: assignment.jobSeries ?? null,
            memberId: assignment.memberId,
            organizationId,
            serviceUnit: assignment.serviceUnit?.trim() || null,
          }),
        )) {
          await tx.insert(hiringUnitOdcMember).values(assignmentBatch);
        }
      }
    }

    if (departmentIds.length > 0) {
      for (let index = 0; index < departmentIds.length; index += ODC_TARGET_QUERY_BATCH_SIZE) {
        const idBatch = departmentIds.slice(index, index + ODC_TARGET_QUERY_BATCH_SIZE);
        await tx
          .update(department)
          .set({ updatedAt: now })
          .where(
            and(eq(department.organizationId, organizationId), inArray(department.id, idBatch)),
          );
        await tx
          .delete(departmentOdcMember)
          .where(
            and(
              eq(departmentOdcMember.organizationId, organizationId),
              inArray(departmentOdcMember.departmentId, idBatch),
            ),
          );
      }
      if (assignments.length > 0) {
        for (const assignmentBatch of buildOdcAssignmentBatches(
          departmentIds,
          assignments,
          (departmentId, assignment) => ({
            departmentId,
            jobSeries: assignment.jobSeries ?? null,
            memberId: assignment.memberId,
            organizationId,
            serviceUnit: assignment.serviceUnit?.trim() || null,
          }),
        )) {
          await tx.insert(departmentOdcMember).values(assignmentBatch);
        }
      }
    }

    return true;
  });
}
