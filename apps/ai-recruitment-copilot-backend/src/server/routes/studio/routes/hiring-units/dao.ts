import type { HiringUnitListRecord, HiringUnitRecord } from "@arc/shared/hiring-units";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
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
import { hiringUnit } from "@arc/db-schema/schema";

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
