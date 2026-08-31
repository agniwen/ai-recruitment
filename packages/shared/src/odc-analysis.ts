import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const optionalDateOnlySchema = z
  .string()
  .trim()
  .refine(isValidDateOnly, "日期格式必须为 YYYY-MM-DD")
  .optional();

export const odcAnalysisDemandDateFieldValues = ["requestedDate", "expectedOnboardDate"] as const;
export type OdcAnalysisDemandDateField = (typeof odcAnalysisDemandDateFieldValues)[number];

export const odcAnalysisResumeActivityValues = [
  "associated_resume",
  "pending_evaluation",
  "ai_interview",
  "human_interview",
  "offer",
  "expected_arrival",
  "onboarded",
  "closed",
] as const;
export type OdcAnalysisResumeActivity = (typeof odcAnalysisResumeActivityValues)[number];

function isValidRange(from?: string, to?: string): boolean {
  return !(from && to) || from <= to;
}

function isRangeWithinLimit(from?: string, to?: string): boolean {
  if (!(from && to)) {
    return true;
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  return (end.getTime() - start.getTime()) / 86_400_000 <= 366;
}

export const odcAnalysisFiltersSchema = z
  .object({
    activityDate: optionalDateOnlySchema,
    activityJobDescriptionIds: z.array(z.string().trim().min(1)).max(100).default([]),
    demandDateField: z.enum(odcAnalysisDemandDateFieldValues).default("requestedDate"),
    demandFrom: optionalDateOnlySchema,
    demandTo: optionalDateOnlySchema,
    progressFrom: optionalDateOnlySchema,
    progressJobDescriptionIds: z.array(z.string().trim().min(1)).max(100).default([]),
    progressTo: optionalDateOnlySchema,
  })
  .refine((value) => isValidRange(value.demandFrom, value.demandTo), {
    message: "开始日期不能晚于结束日期",
    path: ["demandTo"],
  })
  .refine((value) => isRangeWithinLimit(value.demandFrom, value.demandTo), {
    message: "单次时间范围不能超过 366 天",
    path: ["demandTo"],
  })
  .refine((value) => isValidRange(value.progressFrom, value.progressTo), {
    message: "开始日期不能晚于结束日期",
    path: ["progressTo"],
  })
  .refine((value) => isRangeWithinLimit(value.progressFrom, value.progressTo), {
    message: "单次时间范围不能超过 366 天",
    path: ["progressTo"],
  })
  .transform((value) => ({
    ...value,
    activityJobDescriptionIds: [...new Set(value.activityJobDescriptionIds)].toSorted(),
    progressJobDescriptionIds: [...new Set(value.progressJobDescriptionIds)].toSorted(),
  }));

export type OdcAnalysisFilters = z.infer<typeof odcAnalysisFiltersSchema>;

export interface OdcAnalysisMetric {
  value: number;
  unit: "candidate" | "headcount" | "job" | "offer" | "round";
  breakdown?: Record<string, number>;
}

export interface OdcAnalysisDayCount {
  day: string;
  value: number;
}

export interface OdcAnalysisData {
  demand: {
    connectedJobs: OdcAnalysisMetric;
    expectedOnboardDate: string | null;
    onboarded: OdcAnalysisMetric;
    requestedDate: string | null;
    totalHeadcount: OdcAnalysisMetric;
    vacancies: OdcAnalysisMetric;
  };
  filters: OdcAnalysisFilters;
  generatedAt: string;
  overall: {
    aiInterviews: OdcAnalysisMetric;
    associatedResumes: OdcAnalysisMetric;
    currentPendingEvaluation: OdcAnalysisMetric;
    expectedArrivals: OdcAnalysisMetric;
    humanInterviewRounds: OdcAnalysisMetric;
    offers: OdcAnalysisMetric;
    onboarded: OdcAnalysisMetric;
    rejectedOrWithdrawn: OdcAnalysisMetric;
  };
  timeZone: "Asia/Shanghai";
  activity: {
    aiInterviews: OdcAnalysisMetric;
    associatedResumes: OdcAnalysisMetric;
    currentPendingEvaluation: OdcAnalysisMetric;
    expectedArrivals: OdcAnalysisMetric;
    humanInterviewRounds: OdcAnalysisMetric;
    newOffers: OdcAnalysisMetric;
    onboarded: OdcAnalysisMetric;
    rejectedOrWithdrawn: OdcAnalysisMetric;
  };
  activityInterviewStates: {
    completed: number;
    inProgress: number;
    upcoming: number;
  };
  upcoming: {
    aiInterviews: OdcAnalysisDayCount[];
    arrivals: OdcAnalysisDayCount[];
  };
}

export interface OdcAnalysisJobOption {
  code: string | null;
  id: string;
  name: string;
  recruitmentStatus: string | null;
}

export interface OdcAnalysisStateReady {
  access: {
    canViewJobDescriptions: boolean;
    canViewResumes: boolean;
  };
  data: OdcAnalysisData;
  jobs: OdcAnalysisJobOption[];
  status: "ready";
}

export type OdcAnalysisState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | OdcAnalysisStateReady;

export interface OdcAnalysisSearch {
  activityDate?: string;
  activityJdIds?: string;
  demandDateField?: OdcAnalysisDemandDateField;
  demandFrom?: string;
  demandTo?: string;
  progressFrom?: string;
  progressJdIds?: string;
  progressTo?: string;
}

function optionalSearchString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function coerceOdcAnalysisSearch(search: Record<string, unknown>): OdcAnalysisSearch {
  const candidate = {
    activityDate: optionalSearchString(search.activityDate),
    activityJdIds: optionalSearchString(search.activityJdIds),
    demandDateField: optionalSearchString(search.demandDateField),
    demandFrom: optionalSearchString(search.demandFrom),
    demandTo: optionalSearchString(search.demandTo),
    progressFrom: optionalSearchString(search.progressFrom),
    progressJdIds: optionalSearchString(search.progressJdIds),
    progressTo: optionalSearchString(search.progressTo),
  };
  const filters = odcAnalysisFiltersSchema.safeParse({
    activityDate: candidate.activityDate,
    activityJobDescriptionIds: candidate.activityJdIds?.split(",").filter(Boolean) ?? [],
    demandDateField: candidate.demandDateField,
    demandFrom: candidate.demandFrom,
    demandTo: candidate.demandTo,
    progressFrom: candidate.progressFrom,
    progressJobDescriptionIds: candidate.progressJdIds?.split(",").filter(Boolean) ?? [],
    progressTo: candidate.progressTo,
  });
  if (!filters.success) {
    return {};
  }
  return {
    activityDate: filters.data.activityDate,
    activityJdIds:
      filters.data.activityJobDescriptionIds.length > 0
        ? filters.data.activityJobDescriptionIds.join(",")
        : undefined,
    demandDateField:
      filters.data.demandDateField === "requestedDate" ? undefined : filters.data.demandDateField,
    demandFrom: filters.data.demandFrom,
    demandTo: filters.data.demandTo,
    progressFrom: filters.data.progressFrom,
    progressJdIds:
      filters.data.progressJobDescriptionIds.length > 0
        ? filters.data.progressJobDescriptionIds.join(",")
        : undefined,
    progressTo: filters.data.progressTo,
  };
}

export function filtersFromOdcAnalysisSearch(search: OdcAnalysisSearch): OdcAnalysisFilters {
  return odcAnalysisFiltersSchema.parse({
    activityDate: search.activityDate,
    activityJobDescriptionIds: search.activityJdIds?.split(",").filter(Boolean) ?? [],
    demandDateField: search.demandDateField,
    demandFrom: search.demandFrom,
    demandTo: search.demandTo,
    progressFrom: search.progressFrom,
    progressJobDescriptionIds: search.progressJdIds?.split(",").filter(Boolean) ?? [],
    progressTo: search.progressTo,
  });
}
