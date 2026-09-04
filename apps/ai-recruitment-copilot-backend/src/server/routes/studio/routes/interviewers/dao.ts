import type { InterviewerListRecord, InterviewerRecord } from "@arc/shared/interviewers";
import type { MinimaxVoiceId } from "@arc/db-schema/minimax-voices";
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
import { department, interviewer, jobDescriptionInterviewer } from "@arc/db-schema/schema";
import { resolveDepartmentHiringUnitScopeCondition } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";

const interviewerListFiltersSchema = z.object({
  departmentId: z.string().trim().max(120).optional().nullable(),
  search: z.string().trim().max(120).optional().nullable(),
});

const SORT_COLUMNS = ["createdAt", "name", "updatedAt"] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];

const ORDER_COLUMNS = {
  createdAt: interviewer.createdAt,
  name: interviewer.name,
  updatedAt: interviewer.updatedAt,
} as const;

const interviewerPaginationSchema = makePaginationSchema(SORT_COLUMNS);

export type InterviewerPaginationParams = PaginationParams<SortColumn>;

export type PaginatedInterviewerResult = PaginatedResult<InterviewerListRecord>;

function buildWhereConditions({
  organizationId,
  search,
  departmentId,
  scopeCondition,
}: {
  organizationId: string;
  search?: string;
  departmentId?: string;
  scopeCondition?: SQL;
}) {
  const conditions: SQL[] = [eq(interviewer.organizationId, organizationId)];

  if (search) {
    const searchCond = or(
      ilike(interviewer.name, `%${search}%`),
      ilike(interviewer.description, `%${search}%`),
    );
    if (searchCond) {
      conditions.push(searchCond);
    }
  }
  if (departmentId) {
    conditions.push(eq(interviewer.departmentId, departmentId));
  }
  if (scopeCondition) {
    conditions.push(scopeCondition);
  }
  return and(...conditions);
}

function listInterviewerRows({
  organizationId,
  search,
  departmentId,
  sortBy = "createdAt",
  sortOrder = "desc",
  limit,
  offset,
  scopeCondition,
}: {
  organizationId: string;
  search?: string;
  departmentId?: string;
  sortBy?: SortColumn;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
  scopeCondition?: SQL;
}) {
  const where = buildWhereConditions({ departmentId, organizationId, scopeCondition, search });

  let query = db
    .select({
      createdAt: interviewer.createdAt,
      createdBy: interviewer.createdBy,
      departmentId: interviewer.departmentId,
      departmentName: department.name,
      description: interviewer.description,
      id: interviewer.id,
      name: interviewer.name,
      prompt: interviewer.prompt,
      updatedAt: interviewer.updatedAt,
      voice: interviewer.voice,
    })
    .from(interviewer)
    .leftJoin(department, eq(interviewer.departmentId, department.id))
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

async function countInterviewerRows({
  organizationId,
  search,
  departmentId,
  scopeCondition,
}: {
  organizationId: string;
  search?: string;
  departmentId?: string;
  scopeCondition?: SQL;
}) {
  const where = buildWhereConditions({ departmentId, organizationId, scopeCondition, search });
  const [result] = await db
    .select({ count: count() })
    .from(interviewer)
    .leftJoin(department, eq(interviewer.departmentId, department.id))
    .where(where);
  return result?.count ?? 0;
}

async function loadJobDescriptionCounts(interviewerIds: string[]) {
  if (interviewerIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({
      count: count(),
      interviewerId: jobDescriptionInterviewer.interviewerId,
    })
    .from(jobDescriptionInterviewer)
    .where(inArray(jobDescriptionInterviewer.interviewerId, interviewerIds))
    .groupBy(jobDescriptionInterviewer.interviewerId);

  const map = new Map<string, number>();
  for (const id of interviewerIds) {
    map.set(id, 0);
  }
  for (const row of rows) {
    map.set(row.interviewerId, row.count);
  }
  return map;
}

function toInterviewerListRecord(
  row: Awaited<ReturnType<typeof listInterviewerRows>>[number],
  jobDescriptionCount: number,
): InterviewerListRecord {
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    description: row.description,
    id: row.id,
    jobDescriptionCount,
    name: row.name,
    prompt: row.prompt,
    updatedAt: serializeDate(row.updatedAt),
    voice: row.voice,
  };
}

function parseFilters(filters?: { search?: string | null; departmentId?: string | null }) {
  const parsed = interviewerListFiltersSchema.safeParse(filters ?? {});
  if (!parsed.success) {
    return { departmentId: undefined, search: undefined };
  }
  return {
    departmentId: parsed.data.departmentId?.trim() || undefined,
    search: parsed.data.search?.trim() || undefined,
  };
}

export function parseInterviewerPagination(
  params?: Record<string, unknown>,
): InterviewerPaginationParams {
  return interviewerPaginationSchema.parse(params ?? {});
}

export async function queryPaginatedInterviewers(
  organizationId: string,
  filters?: { search?: string | null; departmentId?: string | null; actorUserId?: string | null },
  pagination?: Record<string, unknown>,
): Promise<PaginatedInterviewerResult> {
  const { search, departmentId } = parseFilters(filters);
  const { page, pageSize, sortBy, sortOrder } = parseInterviewerPagination(pagination);
  const offset = (page - 1) * pageSize;
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId: filters?.actorUserId,
    includeOdc: false,
    organizationId,
  });

  const [records, total] = await Promise.all([
    listInterviewerRows({
      departmentId,
      limit: pageSize,
      offset,
      organizationId,
      scopeCondition,
      search,
      sortBy,
      sortOrder,
    }),
    countInterviewerRows({ departmentId, organizationId, scopeCondition, search }),
  ]);

  const countsMap = await loadJobDescriptionCounts(records.map((record) => record.id));

  return {
    page,
    pageSize,
    records: records.map((record) =>
      toInterviewerListRecord(record, countsMap.get(record.id) ?? 0),
    ),
    total,
    totalPages: calcTotalPages(total, pageSize),
  };
}

export function listInterviewers(
  organizationId: string,
  filters?: { search?: string | null; departmentId?: string | null; actorUserId?: string | null },
  pagination?: Record<string, unknown>,
) {
  return queryPaginatedInterviewers(organizationId, filters, pagination);
}

export async function listAllInterviewers(
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<InterviewerListRecord[]> {
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    includeOdc: false,
    organizationId,
  });
  const where = buildWhereConditions({ organizationId, scopeCondition });
  const rows = await db
    .select({
      createdAt: interviewer.createdAt,
      createdBy: interviewer.createdBy,
      departmentId: interviewer.departmentId,
      departmentName: department.name,
      description: interviewer.description,
      id: interviewer.id,
      name: interviewer.name,
      prompt: interviewer.prompt,
      updatedAt: interviewer.updatedAt,
      voice: interviewer.voice,
    })
    .from(interviewer)
    .leftJoin(department, eq(interviewer.departmentId, department.id))
    .where(where)
    .orderBy(asc(interviewer.name));

  return rows.map((row) => ({
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    description: row.description,
    id: row.id,
    jobDescriptionCount: 0,
    name: row.name,
    prompt: row.prompt,
    updatedAt: serializeDate(row.updatedAt),
    voice: row.voice,
  }));
}

export async function loadInterviewerReferenceCounts(id: string) {
  const [result] = await db
    .select({ count: count() })
    .from(jobDescriptionInterviewer)
    .where(eq(jobDescriptionInterviewer.interviewerId, id));

  return {
    jobDescriptionCount: result?.count ?? 0,
  };
}

export async function loadInterviewerById(
  id: string,
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<InterviewerRecord | null> {
  const scopeCondition = await resolveDepartmentHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    includeOdc: false,
    organizationId,
  });
  const [row] = await db
    .select({
      createdAt: interviewer.createdAt,
      createdBy: interviewer.createdBy,
      departmentId: interviewer.departmentId,
      description: interviewer.description,
      id: interviewer.id,
      name: interviewer.name,
      prompt: interviewer.prompt,
      updatedAt: interviewer.updatedAt,
      voice: interviewer.voice,
    })
    .from(interviewer)
    .leftJoin(department, eq(interviewer.departmentId, department.id))
    .where(and(eq(interviewer.id, id), buildWhereConditions({ organizationId, scopeCondition })))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    departmentId: row.departmentId,
    description: row.description,
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    updatedAt: serializeDate(row.updatedAt),
    voice: row.voice as MinimaxVoiceId,
  };
}

export function serializeInterviewer(row: typeof interviewer.$inferSelect): InterviewerRecord {
  return {
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    departmentId: row.departmentId,
    description: row.description,
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    updatedAt: serializeDate(row.updatedAt),
    voice: row.voice as MinimaxVoiceId,
  };
}
