import { listTextQuery } from "@arc/shared/list-text-filters";

export interface JobDescriptionFilters extends Record<string, string> {
  code: string;
  dateField: string;
  dateFrom: string;
  dateTo: string;
  departmentId: string;
  googleSheetStatus: string;
  hiringUnitId: string;
  interviewerId: string;
  recruitmentStatus: string;
  sourceSheet: string;
  validityStatus: string;
}

interface JobDescriptionQueryParams {
  filters: JobDescriptionFilters;
  search: string;
  sortBy: string | undefined;
  sortOrder: "asc" | "desc" | undefined;
}

export function buildJobDescriptionQuery(
  params: JobDescriptionQueryParams,
  pagination?: { page: number; pageSize: number },
) {
  let validityStatus: "active" | "inactive" | undefined;
  if (params.filters.validityStatus === "active") {
    validityStatus = "active";
  } else if (params.filters.validityStatus === "inactive") {
    validityStatus = "inactive";
  }
  const sortBy: "createdAt" | "name" | "updatedAt" =
    params.sortBy === "name" || params.sortBy === "updatedAt" ? params.sortBy : "createdAt";
  return {
    ...listTextQuery(params),
    ...(pagination ? { page: String(pagination.page), pageSize: String(pagination.pageSize) } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.filters.code ? { code: params.filters.code } : {}),
    dateField:
      params.filters.dateField === "expectedOnboardDate"
        ? ("expectedOnboardDate" as const)
        : ("requestedDate" as const),
    ...(params.filters.dateFrom ? { dateFrom: params.filters.dateFrom } : {}),
    ...(params.filters.dateTo ? { dateTo: params.filters.dateTo } : {}),
    ...(params.filters.sourceSheet ? { sourceSheet: params.filters.sourceSheet } : {}),
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
    ...(params.filters.googleSheetStatus
      ? { googleSheetStatus: params.filters.googleSheetStatus }
      : {}),
    ...(validityStatus ? { validityStatus } : {}),
    ...(params.filters.hiringUnitId ? { hiringUnitId: params.filters.hiringUnitId } : {}),
    ...(params.filters.interviewerId ? { interviewerId: params.filters.interviewerId } : {}),
    ...(params.filters.recruitmentStatus
      ? { recruitmentStatus: params.filters.recruitmentStatus }
      : {}),
    sortBy,
    sortOrder: params.sortOrder ?? "desc",
  };
}
