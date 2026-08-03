import type {
  JobDescriptionInterviewerSummary,
  JobDescriptionListRecord,
  JobDescriptionMetrics,
  JobDescriptionRecord,
} from "@arc/shared/job-descriptions";
import {
  createDefaultResumeScreeningPolicy,
  resumeScreeningPolicySchema,
} from "@arc/shared/resume-screening";
import type { MinimaxVoiceId } from "@arc/db-schema/minimax-voices";
import type { SQL } from "drizzle-orm";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { uniq } from "lodash-es";
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
  hiringUnit,
  interviewer,
  jobDescription,
  jobDescriptionHumanInterviewer,
  jobDescriptionInterviewer,
  studioInterview,
  studioInterviewSchedule,
} from "@arc/db-schema/schema";
import {
  buildJobDescriptionHiringUnitScopeCondition,
  resolveDepartmentHiringUnitScopeCondition,
  resolveJobDescriptionHiringUnitScopeCondition,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import { parseJobDescriptionListFilters } from "./utils/job-description-list-filters";
import type {
  JobDescriptionGoogleSheetStatusFilter,
  JobDescriptionListFilterInput,
} from "./utils/job-description-list-filters";

const jobHiringUnit = alias(hiringUnit, "job_description_hiring_unit");
const departmentHiringUnit = alias(hiringUnit, "job_description_department_hiring_unit");

const SORT_COLUMNS = ["createdAt", "name", "updatedAt"] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];

const ORDER_COLUMNS = {
  createdAt: jobDescription.createdAt,
  name: jobDescription.name,
  updatedAt: jobDescription.updatedAt,
} as const;

const jobDescriptionPaginationSchema = makePaginationSchema(SORT_COLUMNS);

export type JobDescriptionPaginationParams = PaginationParams<SortColumn>;

export type PaginatedJobDescriptionResult = PaginatedResult<JobDescriptionListRecord>;

function parseResumeScreeningPolicy(value: unknown) {
  const parsedPolicy = resumeScreeningPolicySchema.safeParse(value);
  return parsedPolicy.success ? parsedPolicy.data : createDefaultResumeScreeningPolicy();
}

export function resolveJobDescriptionHiringUnit(row: {
  creationSource: "google_sheets" | "manual";
  departmentHiringUnitId?: string | null;
  departmentHiringUnitName?: string | null;
  hiringUnitId?: string | null;
  hiringUnitName?: string | null;
}) {
  if (row.creationSource === "google_sheets") {
    return {
      hiringUnitId: row.hiringUnitId ?? null,
      hiringUnitName: row.hiringUnitName ?? null,
    };
  }
  return {
    hiringUnitId: row.hiringUnitId ?? row.departmentHiringUnitId ?? null,
    hiringUnitName: row.hiringUnitName ?? row.departmentHiringUnitName ?? null,
  };
}

function buildGoogleSheetStatusCondition(
  statuses: JobDescriptionGoogleSheetStatusFilter[] | undefined,
) {
  if (!statuses || statuses.length === 0) {
    return;
  }
  return or(
    statuses.includes("active") ? eq(jobDescription.googleSheetDeleted, false) : undefined,
    statuses.includes("deleted") ? eq(jobDescription.googleSheetDeleted, true) : undefined,
    statuses.includes("unlinked") ? isNull(jobDescription.googleSheetDeleted) : undefined,
  );
}

function buildWhereConditions({
  code,
  googleSheetStatuses,
  organizationId,
  recruitmentStatuses,
  search,
  sourceSheet,
  departmentIds,
  hiringUnitIds,
  interviewerIds,
  jdIdsForInterviewers,
  scopeCondition,
}: {
  code?: string;
  googleSheetStatuses?: JobDescriptionGoogleSheetStatusFilter[];
  organizationId: string;
  recruitmentStatuses?: string[];
  search?: string;
  sourceSheet?: string;
  departmentIds?: string[];
  hiringUnitIds?: string[];
  interviewerIds?: string[];
  jdIdsForInterviewers?: string[];
  scopeCondition?: SQL;
}) {
  const conditions: SQL[] = [eq(jobDescription.organizationId, organizationId)];
  if (code) {
    conditions.push(ilike(jobDescription.code, `%${code}%`));
  }
  if (sourceSheet) {
    conditions.push(eq(jobDescription.sourceSheet, sourceSheet));
  }
  if (recruitmentStatuses && recruitmentStatuses.length > 0) {
    conditions.push(inArray(jobDescription.recruitmentStatus, recruitmentStatuses));
  }
  const googleSheetStatusCondition = buildGoogleSheetStatusCondition(googleSheetStatuses);
  if (googleSheetStatusCondition) {
    conditions.push(googleSheetStatusCondition);
  }
  if (search) {
    const searchCond = or(
      ilike(jobDescription.name, `%${search}%`),
      ilike(jobDescription.description, `%${search}%`),
    );
    if (searchCond) {
      conditions.push(searchCond);
    }
  }
  if (departmentIds && departmentIds.length > 0) {
    conditions.push(inArray(jobDescription.departmentId, departmentIds));
  }
  if (hiringUnitIds && hiringUnitIds.length > 0) {
    const hiringUnitCondition = buildJobDescriptionHiringUnitScopeCondition({
      canAccessAll: false,
      canAccessPublic: false,
      hiringUnitIds,
    });
    if (hiringUnitCondition) {
      conditions.push(hiringUnitCondition);
    }
  }
  if (interviewerIds && interviewerIds.length > 0) {
    if (!jdIdsForInterviewers || jdIdsForInterviewers.length === 0) {
      // 选了面试官但没有任何关联 JD → 永远不命中 / short-circuit empty result.
      conditions.push(eq(jobDescription.id, "__never__"));
    } else {
      conditions.push(inArray(jobDescription.id, jdIdsForInterviewers));
    }
  }
  if (scopeCondition) {
    conditions.push(scopeCondition);
  }
  return and(...conditions);
}

async function resolveJdIdsForInterviewers(
  organizationId: string,
  interviewerIds?: string[],
): Promise<string[] | undefined> {
  if (!interviewerIds || interviewerIds.length === 0) {
    return;
  }
  const rows = await db
    .select({ jobDescriptionId: jobDescriptionInterviewer.jobDescriptionId })
    .from(jobDescriptionInterviewer)
    .innerJoin(interviewer, eq(jobDescriptionInterviewer.interviewerId, interviewer.id))
    .where(
      and(
        inArray(jobDescriptionInterviewer.interviewerId, interviewerIds),
        eq(interviewer.organizationId, organizationId),
      ),
    );
  // 任意一个面试官 → 该 JD 命中（OR 语义）/ Any matching interviewer surfaces the JD.
  return uniq(rows.map((row) => row.jobDescriptionId));
}

function listJobDescriptionRows({
  code,
  googleSheetStatuses,
  organizationId,
  recruitmentStatuses,
  search,
  sourceSheet,
  departmentIds,
  hiringUnitIds,
  interviewerIds,
  jdIdsForInterviewers,
  scopeCondition,
  sortBy = "createdAt",
  sortOrder = "desc",
  limit,
  offset,
}: {
  code?: string;
  googleSheetStatuses?: JobDescriptionGoogleSheetStatusFilter[];
  organizationId: string;
  recruitmentStatuses?: string[];
  search?: string;
  sourceSheet?: string;
  departmentIds?: string[];
  hiringUnitIds?: string[];
  interviewerIds?: string[];
  jdIdsForInterviewers?: string[];
  scopeCondition?: SQL;
  sortBy?: SortColumn;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const where = buildWhereConditions({
    code,
    departmentIds,
    googleSheetStatuses,
    hiringUnitIds,
    interviewerIds,
    jdIdsForInterviewers,
    organizationId,
    recruitmentStatuses,
    scopeCondition,
    search,
    sourceSheet,
  });

  let query = db
    .select({
      aiInterviewDisabled: jobDescription.aiInterviewDisabled,
      allowCrossDepartmentInterviewers: jobDescription.allowCrossDepartmentInterviewers,
      code: jobDescription.code,
      controlCategory: jobDescription.controlCategory,
      createdAt: jobDescription.createdAt,
      createdBy: jobDescription.createdBy,
      creationSource: jobDescription.creationSource,
      departmentHiringUnitId: department.hiringUnitId,
      departmentHiringUnitName: departmentHiringUnit.name,
      departmentId: jobDescription.departmentId,
      departmentName: department.name,
      description: jobDescription.description,
      expectedOnboardDate: jobDescription.expectedOnboardDate,
      gapCount: jobDescription.gapCount,
      googleSheetDeleted: jobDescription.googleSheetDeleted,
      headcount: jobDescription.headcount,
      hiringUnitId: jobDescription.hiringUnitId,
      hiringUnitName: jobHiringUnit.name,
      id: jobDescription.id,
      jobLevel: jobDescription.jobLevel,
      jobSeries: jobDescription.jobSeries,
      name: jobDescription.name,
      notes: jobDescription.notes,
      offeredPendingOnboardCount: jobDescription.offeredPendingOnboardCount,
      onboardedCount: jobDescription.onboardedCount,
      presetQuestions: jobDescription.presetQuestions,
      priority: jobDescription.priority,
      prompt: jobDescription.prompt,
      recruitmentStatus: jobDescription.recruitmentStatus,
      requestedDate: jobDescription.requestedDate,
      requester: jobDescription.requester,
      resumeContact: jobDescription.resumeContact,
      resumeScreeningPolicy: jobDescription.resumeScreeningPolicy,
      resumeScreeningPolicyHash: jobDescription.resumeScreeningPolicyHash,
      resumeScreeningPolicyVersion: jobDescription.resumeScreeningPolicyVersion,
      salaryCurrency: jobDescription.salaryCurrency,
      salaryMaxAmount: jobDescription.salaryMaxAmount,
      salaryMinAmount: jobDescription.salaryMinAmount,
      salaryRangeRaw: jobDescription.salaryRangeRaw,
      serviceUnit: jobDescription.serviceUnit,
      sourceSheet: jobDescription.sourceSheet,
      updatedAt: jobDescription.updatedAt,
      workEndTime: jobDescription.workEndTime,
      workLocation: jobDescription.workLocation,
      workStartTime: jobDescription.workStartTime,
      workTimezone: jobDescription.workTimezone,
    })
    .from(jobDescription)
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .leftJoin(jobHiringUnit, eq(jobDescription.hiringUnitId, jobHiringUnit.id))
    .leftJoin(departmentHiringUnit, eq(department.hiringUnitId, departmentHiringUnit.id))
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

async function countJobDescriptionRows({
  code,
  googleSheetStatuses,
  organizationId,
  recruitmentStatuses,
  search,
  sourceSheet,
  departmentIds,
  hiringUnitIds,
  interviewerIds,
  jdIdsForInterviewers,
  scopeCondition,
}: {
  code?: string;
  googleSheetStatuses?: JobDescriptionGoogleSheetStatusFilter[];
  organizationId: string;
  recruitmentStatuses?: string[];
  search?: string;
  sourceSheet?: string;
  departmentIds?: string[];
  hiringUnitIds?: string[];
  interviewerIds?: string[];
  jdIdsForInterviewers?: string[];
  scopeCondition?: SQL;
}) {
  const where = buildWhereConditions({
    code,
    departmentIds,
    googleSheetStatuses,
    hiringUnitIds,
    interviewerIds,
    jdIdsForInterviewers,
    organizationId,
    recruitmentStatuses,
    scopeCondition,
    search,
    sourceSheet,
  });
  const [result] = await db
    .select({ count: count() })
    .from(jobDescription)
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .where(where);
  return result?.count ?? 0;
}

async function loadInterviewersForJobDescriptions(
  jobDescriptionIds: string[],
): Promise<Map<string, JobDescriptionInterviewerSummary[]>> {
  const map = new Map<string, JobDescriptionInterviewerSummary[]>();
  if (jobDescriptionIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({
      interviewerId: jobDescriptionInterviewer.interviewerId,
      interviewerName: interviewer.name,
      interviewerVoice: interviewer.voice,
      jobDescriptionId: jobDescriptionInterviewer.jobDescriptionId,
    })
    .from(jobDescriptionInterviewer)
    .innerJoin(jobDescription, eq(jobDescriptionInterviewer.jobDescriptionId, jobDescription.id))
    .innerJoin(interviewer, eq(jobDescriptionInterviewer.interviewerId, interviewer.id))
    .where(
      and(
        inArray(jobDescriptionInterviewer.jobDescriptionId, jobDescriptionIds),
        eq(interviewer.organizationId, jobDescription.organizationId),
      ),
    )
    .orderBy(asc(interviewer.name));

  for (const id of jobDescriptionIds) {
    map.set(id, []);
  }
  for (const row of rows) {
    const list = map.get(row.jobDescriptionId);
    if (list) {
      list.push({
        id: row.interviewerId,
        name: row.interviewerName,
        voice: row.interviewerVoice as MinimaxVoiceId,
      });
    }
  }
  return map;
}

async function loadHumanInterviewerIdsForJobDescriptions(
  jobDescriptionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map(jobDescriptionIds.map((id) => [id, [] as string[]]));
  if (jobDescriptionIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({
      jobDescriptionId: jobDescriptionHumanInterviewer.jobDescriptionId,
      userId: jobDescriptionHumanInterviewer.userId,
    })
    .from(jobDescriptionHumanInterviewer)
    .where(inArray(jobDescriptionHumanInterviewer.jobDescriptionId, jobDescriptionIds));

  for (const row of rows) {
    map.get(row.jobDescriptionId)?.push(row.userId);
  }
  return map;
}

async function loadResumeCountsForJobDescriptions(
  jobDescriptionIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (jobDescriptionIds.length === 0) {
    return map;
  }
  // 与 candidatesByJd 卡片保持一致：归档候选人不计入。
  // Mirror the candidatesByJd card: archived candidates are excluded.
  const rows = await db
    .select({
      count: count(),
      jobDescriptionId: studioInterview.jobDescriptionId,
    })
    .from(studioInterview)
    .where(
      and(
        inArray(studioInterview.jobDescriptionId, jobDescriptionIds),
        ne(studioInterview.pipelineStage, "closed"),
      ),
    )
    .groupBy(studioInterview.jobDescriptionId);

  for (const id of jobDescriptionIds) {
    map.set(id, 0);
  }
  for (const row of rows) {
    if (row.jobDescriptionId) {
      map.set(row.jobDescriptionId, row.count);
    }
  }
  return map;
}

function toJobDescriptionListRecord(
  row: Awaited<ReturnType<typeof listJobDescriptionRows>>[number],
  interviewers: JobDescriptionInterviewerSummary[],
  humanInterviewerIds: string[],
  resumeCount: number,
): JobDescriptionListRecord {
  const resumeScreeningPolicy = parseResumeScreeningPolicy(row.resumeScreeningPolicy);
  const effectiveHiringUnit = resolveJobDescriptionHiringUnit(row);
  return {
    aiInterviewDisabled: row.aiInterviewDisabled,
    allowCrossDepartmentInterviewers: row.allowCrossDepartmentInterviewers,
    code: row.code,
    controlCategory: row.controlCategory,
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    creationSource: row.creationSource,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    description: row.description,
    expectedOnboardDate: row.expectedOnboardDate,
    gapCount: row.gapCount,
    googleSheetDeleted: row.googleSheetDeleted,
    headcount: row.headcount,
    hiringUnitId: effectiveHiringUnit.hiringUnitId,
    hiringUnitName: effectiveHiringUnit.hiringUnitName,
    humanInterviewerIds,
    id: row.id,
    interviewerIds: interviewers.map((item) => item.id),
    interviewers,
    jobLevel: row.jobLevel,
    jobSeries: row.jobSeries,
    name: row.name,
    notes: row.notes,
    offeredPendingOnboardCount: row.offeredPendingOnboardCount,
    onboardedCount: row.onboardedCount,
    presetQuestions: row.presetQuestions ?? [],
    priority: row.priority,
    prompt: row.prompt,
    recruitmentStatus: row.recruitmentStatus,
    requestedDate: row.requestedDate,
    requester: row.requester,
    resumeContact: row.resumeContact,
    resumeCount,
    resumeScreeningPolicy,
    resumeScreeningPolicyHash: row.resumeScreeningPolicyHash,
    resumeScreeningPolicyVersion: row.resumeScreeningPolicyVersion,
    salaryCurrency: row.salaryCurrency,
    salaryMaxAmount: row.salaryMaxAmount,
    salaryMinAmount: row.salaryMinAmount,
    salaryRangeRaw: row.salaryRangeRaw,
    serviceUnit: row.serviceUnit,
    sourceSheet: row.sourceSheet,
    updatedAt: serializeDate(row.updatedAt),
    workEndTime: row.workEndTime,
    workLocation: row.workLocation,
    workStartTime: row.workStartTime,
    workTimezone: row.workTimezone,
  };
}

export function parseJobDescriptionPagination(
  params?: Record<string, unknown>,
): JobDescriptionPaginationParams {
  return jobDescriptionPaginationSchema.parse(params ?? {});
}

export async function queryPaginatedJobDescriptions(
  organizationId: string,
  filters?: JobDescriptionListFilterInput & { actorUserId?: string | null },
  pagination?: Record<string, unknown>,
): Promise<PaginatedJobDescriptionResult> {
  const {
    code,
    departmentIds,
    googleSheetStatuses,
    hiringUnitIds,
    interviewerIds,
    recruitmentStatuses,
    search,
    sourceSheet,
  } = parseJobDescriptionListFilters(filters);
  const { page, pageSize, sortBy, sortOrder } = parseJobDescriptionPagination(pagination);
  const offset = (page - 1) * pageSize;
  const jdIdsForInterviewers = await resolveJdIdsForInterviewers(organizationId, interviewerIds);
  const scopeCondition = await resolveJobDescriptionHiringUnitScopeCondition({
    actorUserId: filters?.actorUserId,
    organizationId,
  });

  const [records, total] = await Promise.all([
    listJobDescriptionRows({
      code,
      departmentIds,
      googleSheetStatuses,
      hiringUnitIds,
      interviewerIds,
      jdIdsForInterviewers,
      limit: pageSize,
      offset,
      organizationId,
      recruitmentStatuses,
      scopeCondition,
      search,
      sortBy,
      sortOrder,
      sourceSheet,
    }),
    countJobDescriptionRows({
      code,
      departmentIds,
      googleSheetStatuses,
      hiringUnitIds,
      interviewerIds,
      jdIdsForInterviewers,
      organizationId,
      recruitmentStatuses,
      scopeCondition,
      search,
      sourceSheet,
    }),
  ]);

  const ids = records.map((record) => record.id);
  const [humanInterviewerIdsMap, interviewersMap, resumeCountsMap] = await Promise.all([
    loadHumanInterviewerIdsForJobDescriptions(ids),
    loadInterviewersForJobDescriptions(ids),
    loadResumeCountsForJobDescriptions(ids),
  ]);

  return {
    page,
    pageSize,
    records: records.map((record) =>
      toJobDescriptionListRecord(
        record,
        interviewersMap.get(record.id) ?? [],
        humanInterviewerIdsMap.get(record.id) ?? [],
        resumeCountsMap.get(record.id) ?? 0,
      ),
    ),
    total,
    totalPages: calcTotalPages(total, pageSize),
  };
}

export function listJobDescriptions(
  organizationId: string,
  filters?: JobDescriptionListFilterInput & { actorUserId?: string | null },
  pagination?: Record<string, unknown>,
) {
  return queryPaginatedJobDescriptions(organizationId, filters, pagination);
}

export async function loadJobDescriptionFilterOptions(
  organizationId: string,
  options?: { actorUserId?: string | null },
) {
  const scopeCondition = await resolveJobDescriptionHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    organizationId,
  });
  const [row] = await db
    .select({
      recruitmentStatuses: sql<string[]>`
        coalesce(
          array_agg(
            distinct ${jobDescription.recruitmentStatus}
            order by ${jobDescription.recruitmentStatus}
          ) filter (
            where ${jobDescription.recruitmentStatus} is not null
              and btrim(${jobDescription.recruitmentStatus}) <> ''
          ),
          '{}'::text[]
        )
      `,
      sourceSheets: sql<string[]>`
        coalesce(
          array_agg(
            distinct ${jobDescription.sourceSheet}
            order by ${jobDescription.sourceSheet}
          ) filter (
            where ${jobDescription.sourceSheet} is not null
              and btrim(${jobDescription.sourceSheet}) <> ''
          ),
          '{}'::text[]
        )
      `,
    })
    .from(jobDescription)
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .where(and(eq(jobDescription.organizationId, organizationId), scopeCondition));
  return {
    recruitmentStatuses: row?.recruitmentStatuses ?? [],
    sourceSheets: row?.sourceSheets ?? [],
  };
}

export async function listAllJobDescriptions(
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<JobDescriptionListRecord[]> {
  const scopeCondition = await resolveJobDescriptionHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    organizationId,
  });
  const rows = await listJobDescriptionRows({
    organizationId,
    scopeCondition,
    sortBy: "name",
    sortOrder: "asc",
  });
  const ids = rows.map((row) => row.id);
  const [humanInterviewerIdsMap, interviewersMap, resumeCountsMap] = await Promise.all([
    loadHumanInterviewerIdsForJobDescriptions(ids),
    loadInterviewersForJobDescriptions(ids),
    loadResumeCountsForJobDescriptions(ids),
  ]);
  return rows.map((row) =>
    toJobDescriptionListRecord(
      row,
      interviewersMap.get(row.id) ?? [],
      humanInterviewerIdsMap.get(row.id) ?? [],
      resumeCountsMap.get(row.id) ?? 0,
    ),
  );
}

/**
 * 校验给定 ids 全部存在于 jobDescription 表。空数组视作合法。
 * Validate that every id in `ids` exists in jobDescription. Empty input is valid.
 */
export async function fetchJobDescriptionsByCodes(
  organizationId: string,
  codes: readonly string[],
): Promise<{ code: string; id: string }[]> {
  const normalizedCodes = uniq(codes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  if (normalizedCodes.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      code: jobDescription.code,
      id: jobDescription.id,
    })
    .from(jobDescription)
    .where(
      and(
        eq(jobDescription.organizationId, organizationId),
        inArray(jobDescription.code, normalizedCodes),
      ),
    );
  return rows.flatMap((row) => (row.code ? [{ code: row.code, id: row.id }] : []));
}

export async function jobDescriptionIdsExist(
  ids: string[],
  organizationId: string,
): Promise<boolean> {
  if (ids.length === 0) {
    return true;
  }
  const rows = await db
    .select({ id: jobDescription.id })
    .from(jobDescription)
    .where(and(inArray(jobDescription.id, ids), eq(jobDescription.organizationId, organizationId)));
  return rows.length === new Set(ids).size;
}

export async function loadJobDescriptionById(
  organizationId: string,
  id: string,
  options?: { actorUserId?: string | null },
): Promise<JobDescriptionRecord | null> {
  const scopeCondition = await resolveJobDescriptionHiringUnitScopeCondition({
    actorUserId: options?.actorUserId,
    organizationId,
  });
  const where = and(
    eq(jobDescription.id, id),
    buildWhereConditions({ organizationId, scopeCondition }),
  );
  const [row] = await db
    .select({
      aiInterviewDisabled: jobDescription.aiInterviewDisabled,
      allowCrossDepartmentInterviewers: jobDescription.allowCrossDepartmentInterviewers,
      code: jobDescription.code,
      controlCategory: jobDescription.controlCategory,
      createdAt: jobDescription.createdAt,
      createdBy: jobDescription.createdBy,
      creationSource: jobDescription.creationSource,
      departmentHiringUnitId: department.hiringUnitId,
      departmentHiringUnitName: departmentHiringUnit.name,
      departmentId: jobDescription.departmentId,
      description: jobDescription.description,
      expectedOnboardDate: jobDescription.expectedOnboardDate,
      feishuChatBoundAt: jobDescription.feishuChatBoundAt,
      feishuChatBoundBy: jobDescription.feishuChatBoundBy,
      feishuChatId: jobDescription.feishuChatId,
      gapCount: jobDescription.gapCount,
      googleSheetDeleted: jobDescription.googleSheetDeleted,
      headcount: jobDescription.headcount,
      hiringUnitId: jobDescription.hiringUnitId,
      hiringUnitName: jobHiringUnit.name,
      id: jobDescription.id,
      jobLevel: jobDescription.jobLevel,
      jobSeries: jobDescription.jobSeries,
      name: jobDescription.name,
      notes: jobDescription.notes,
      offeredPendingOnboardCount: jobDescription.offeredPendingOnboardCount,
      onboardedCount: jobDescription.onboardedCount,
      organizationId: jobDescription.organizationId,
      presetQuestions: jobDescription.presetQuestions,
      priority: jobDescription.priority,
      prompt: jobDescription.prompt,
      recruitmentStatus: jobDescription.recruitmentStatus,
      requestedDate: jobDescription.requestedDate,
      requester: jobDescription.requester,
      resumeContact: jobDescription.resumeContact,
      resumeScreeningPolicy: jobDescription.resumeScreeningPolicy,
      resumeScreeningPolicyHash: jobDescription.resumeScreeningPolicyHash,
      resumeScreeningPolicyVersion: jobDescription.resumeScreeningPolicyVersion,
      salaryCurrency: jobDescription.salaryCurrency,
      salaryMaxAmount: jobDescription.salaryMaxAmount,
      salaryMinAmount: jobDescription.salaryMinAmount,
      salaryRangeRaw: jobDescription.salaryRangeRaw,
      serviceUnit: jobDescription.serviceUnit,
      sourceSheet: jobDescription.sourceSheet,
      updatedAt: jobDescription.updatedAt,
      workEndTime: jobDescription.workEndTime,
      workLocation: jobDescription.workLocation,
      workStartTime: jobDescription.workStartTime,
      workTimezone: jobDescription.workTimezone,
    })
    .from(jobDescription)
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .leftJoin(jobHiringUnit, eq(jobDescription.hiringUnitId, jobHiringUnit.id))
    .leftJoin(departmentHiringUnit, eq(department.hiringUnitId, departmentHiringUnit.id))
    .where(where)
    .limit(1);
  if (!row) {
    return null;
  }
  const [humanInterviewerIdsMap, interviewersMap] = await Promise.all([
    loadHumanInterviewerIdsForJobDescriptions([id]),
    loadInterviewersForJobDescriptions([id]),
  ]);
  const interviewers = interviewersMap.get(id) ?? [];
  // eslint-disable-next-line no-use-before-define -- kept near public load functions for readability.
  return serializeJobDescription(
    row,
    interviewers.map((item) => item.id),
    humanInterviewerIdsMap.get(id) ?? [],
  );
}

// =========================================================================
// 头部 chart 聚合查询 / Header chart aggregations.
// =========================================================================

// 各卡片 Top N 上限：候选人分布卡用 treemap，撑得住 10 块；完成率 / 面试官负载
// 是分类条形，超过 5 条就显拥挤。
// Per-card Top N caps: the candidates treemap can host 10 cells comfortably,
// while the completion-rate bar and interviewer-load bar collapse past 5 rows.
const TOP_N_CANDIDATES = 10;
const TOP_N_COMPLETION = 5;
const TOP_N_LOAD = 5;

async function loadCandidatesByJd(organizationId: string, scopeCondition?: SQL) {
  // 每个 JD 关联的非归档简历数 Top N。LEFT JOIN 让没简历的 JD 也出现在结果集（0 候选）。
  // Top N JDs by non-archived candidate count. LEFT JOIN keeps JDs with zero
  // candidates in the result set (they'll surface only if Top N isn't filled).
  const rows = await db
    .select({
      count: count(studioInterview.id),
      id: jobDescription.id,
      name: jobDescription.name,
    })
    .from(jobDescription)
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .leftJoin(
      studioInterview,
      and(
        eq(studioInterview.jobDescriptionId, jobDescription.id),
        eq(studioInterview.organizationId, organizationId),
        ne(studioInterview.pipelineStage, "closed"),
      ),
    )
    .where(and(eq(jobDescription.organizationId, organizationId), scopeCondition))
    .groupBy(jobDescription.id, jobDescription.name)
    .orderBy(desc(count(studioInterview.id)), asc(jobDescription.name))
    .limit(TOP_N_CANDIDATES);

  return rows.map((row) => ({ count: row.count, id: row.id, name: row.name }));
}

async function loadCompletionByJd(organizationId: string, scopeCondition?: SQL) {
  // 每个 JD 名下所有候选人的轮次完成率：completed 数 / 总数。
  // HAVING total > 0 过滤掉完全没安排面试的 JD，避免 0/0 占满图。
  // 排序按完成率 desc，名字 asc 兜底。
  // Completion ratio per JD across all its candidates' schedule rows.
  // HAVING total > 0 hides JDs that have no scheduled rounds at all so the
  // chart doesn't fill up with 0/0 entries. Sorted by completion ratio desc.
  const done =
    sql<number>`COUNT(${studioInterviewSchedule.id}) FILTER (WHERE ${studioInterviewSchedule.status} = 'completed')`.mapWith(
      Number,
    );
  const total = sql<number>`COUNT(${studioInterviewSchedule.id})`.mapWith(Number);

  const rows = await db
    .select({
      done,
      id: jobDescription.id,
      name: jobDescription.name,
      total,
    })
    .from(jobDescription)
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .innerJoin(
      studioInterview,
      and(
        eq(studioInterview.jobDescriptionId, jobDescription.id),
        eq(studioInterview.organizationId, organizationId),
      ),
    )
    .innerJoin(
      studioInterviewSchedule,
      eq(studioInterviewSchedule.interviewRecordId, studioInterview.id),
    )
    .where(
      and(
        eq(jobDescription.organizationId, organizationId),
        ne(studioInterview.pipelineStage, "closed"),
        scopeCondition,
      ),
    )
    .groupBy(jobDescription.id, jobDescription.name)
    .having(sql`COUNT(${studioInterviewSchedule.id}) > 0`)
    .orderBy(desc(sql`(${done})::float / NULLIF(${total}, 0)`), asc(jobDescription.name))
    .limit(TOP_N_COMPLETION);

  return rows.map((row) => ({
    done: row.done,
    id: row.id,
    name: row.name,
    total: row.total,
  }));
}

async function loadLoadByInterviewer(organizationId: string, scopeCondition?: SQL) {
  // 通过 job_description_interviewer 关联到 studio_interview，
  // 统计每位面试官当前 status ∈ {ready, in_progress} 的候选人数 DISTINCT 计数。
  // DISTINCT 是因为同一候选人可能落在多个 JD 的同一面试官关联上——但实际 schema
  // 是 1 候选人:1 JD，DISTINCT 主要做保险。
  // Walk interviewer → jobDescriptionInterviewer → studio_interview, counting
  // active (ready / in_progress) candidates per interviewer. DISTINCT is a
  // safety net — schema-wise a candidate maps to a single JD, so duplicates
  // shouldn't appear in practice.
  const rows = await db
    .select({
      activeCandidates: sql<number>`COUNT(DISTINCT ${studioInterview.id})`.mapWith(Number),
      id: interviewer.id,
      name: interviewer.name,
    })
    .from(interviewer)
    .leftJoin(department, eq(interviewer.departmentId, department.id))
    .innerJoin(
      jobDescriptionInterviewer,
      eq(jobDescriptionInterviewer.interviewerId, interviewer.id),
    )
    .innerJoin(
      studioInterview,
      and(
        eq(studioInterview.jobDescriptionId, jobDescriptionInterviewer.jobDescriptionId),
        eq(studioInterview.organizationId, organizationId),
        inArray(studioInterview.pipelineStage, ["ai_interview", "human_interview", "offer"]),
      ),
    )
    .where(and(eq(interviewer.organizationId, organizationId), scopeCondition))
    .groupBy(interviewer.id, interviewer.name)
    .having(sql`COUNT(DISTINCT ${studioInterview.id}) > 0`)
    .orderBy(desc(sql`COUNT(DISTINCT ${studioInterview.id})`), asc(interviewer.name))
    .limit(TOP_N_LOAD);

  return rows.map((row) => ({
    activeCandidates: row.activeCandidates,
    id: row.id,
    name: row.name,
  }));
}

async function queryJobDescriptionMetrics(
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<JobDescriptionMetrics> {
  const [jobScopeCondition, departmentScopeCondition] = await Promise.all([
    resolveJobDescriptionHiringUnitScopeCondition({
      actorUserId: options?.actorUserId,
      organizationId,
    }),
    resolveDepartmentHiringUnitScopeCondition({
      actorUserId: options?.actorUserId,
      organizationId,
    }),
  ]);
  const [candidatesByJd, completionByJd, loadByInterviewer] = await Promise.all([
    loadCandidatesByJd(organizationId, jobScopeCondition),
    loadCompletionByJd(organizationId, jobScopeCondition),
    loadLoadByInterviewer(organizationId, departmentScopeCondition),
  ]);
  return { candidatesByJd, completionByJd, loadByInterviewer };
}

/**
 * 在招岗位管理页头部 chart 聚合的缓存入口。
 * cacheTag 与列表查询共用 `job-descriptions`，再额外打 `studio-resumes` —— 候选人维度
 * 数据也会驱动 candidatesByJd / completionByJd / loadByInterviewer，简历库写操作必须能拉到新值。
 *
 * Cached entry for the JD-management header charts. Carries both the
 * `job-descriptions` tag (list-query parity) and `studio-resumes` because the
 * candidate-derived bars need to refresh whenever a resume row mutates.
 */
export function loadJobDescriptionMetrics(
  organizationId: string,
  options?: { actorUserId?: string | null },
): Promise<JobDescriptionMetrics> {
  return queryJobDescriptionMetrics(organizationId, options);
}

export function serializeJobDescription(
  row: typeof jobDescription.$inferSelect & {
    departmentHiringUnitId?: string | null;
    departmentHiringUnitName?: string | null;
    hiringUnitId?: string | null;
    hiringUnitName?: string | null;
  },
  interviewerIds: string[],
  humanInterviewerIds: string[],
): JobDescriptionRecord {
  const resumeScreeningPolicy = parseResumeScreeningPolicy(row.resumeScreeningPolicy);
  const effectiveHiringUnit = resolveJobDescriptionHiringUnit(row);
  return {
    aiInterviewDisabled: row.aiInterviewDisabled,
    allowCrossDepartmentInterviewers: row.allowCrossDepartmentInterviewers,
    code: row.code,
    controlCategory: row.controlCategory,
    createdAt: serializeDate(row.createdAt),
    createdBy: row.createdBy,
    creationSource: row.creationSource,
    departmentId: row.departmentId,
    description: row.description,
    expectedOnboardDate: row.expectedOnboardDate,
    gapCount: row.gapCount,
    googleSheetDeleted: row.googleSheetDeleted ?? null,
    headcount: row.headcount,
    hiringUnitId: effectiveHiringUnit.hiringUnitId,
    hiringUnitName: effectiveHiringUnit.hiringUnitName,
    humanInterviewerIds,
    id: row.id,
    interviewerIds,
    jobLevel: row.jobLevel,
    jobSeries: row.jobSeries,
    name: row.name,
    notes: row.notes,
    offeredPendingOnboardCount: row.offeredPendingOnboardCount,
    onboardedCount: row.onboardedCount,
    presetQuestions: row.presetQuestions ?? [],
    priority: row.priority,
    prompt: row.prompt,
    recruitmentStatus: row.recruitmentStatus,
    requestedDate: row.requestedDate,
    requester: row.requester,
    resumeContact: row.resumeContact,
    resumeScreeningPolicy,
    resumeScreeningPolicyHash: row.resumeScreeningPolicyHash,
    resumeScreeningPolicyVersion: row.resumeScreeningPolicyVersion,
    salaryCurrency: row.salaryCurrency,
    salaryMaxAmount: row.salaryMaxAmount,
    salaryMinAmount: row.salaryMinAmount,
    salaryRangeRaw: row.salaryRangeRaw,
    serviceUnit: row.serviceUnit,
    sourceSheet: row.sourceSheet,
    updatedAt: serializeDate(row.updatedAt),
    workEndTime: row.workEndTime,
    workLocation: row.workLocation,
    workStartTime: row.workStartTime,
    workTimezone: row.workTimezone,
  };
}
