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

export const odcAnalysisFiltersSchema = z
  .object({
    from: optionalDateOnlySchema,
    jobDescriptionIds: z.array(z.string().trim().min(1)).max(100).default([]),
    to: optionalDateOnlySchema,
  })
  .refine((value) => !(value.from && value.to) || value.from <= value.to, {
    message: "开始日期不能晚于结束日期",
    path: ["to"],
  })
  .refine(
    (value) => {
      if (!(value.from && value.to)) {
        return true;
      }
      const from = new Date(`${value.from}T00:00:00.000Z`);
      const to = new Date(`${value.to}T00:00:00.000Z`);
      return (to.getTime() - from.getTime()) / 86_400_000 <= 366;
    },
    { message: "单次时间范围不能超过 366 天", path: ["to"] },
  )
  .transform((value) => ({
    ...value,
    jobDescriptionIds: [...new Set(value.jobDescriptionIds)].toSorted(),
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
  today: {
    aiInterviews: OdcAnalysisMetric;
    associatedResumes: OdcAnalysisMetric;
    currentPendingEvaluation: OdcAnalysisMetric;
    expectedArrivals: OdcAnalysisMetric;
    humanInterviewRounds: OdcAnalysisMetric;
    newOffers: OdcAnalysisMetric;
    onboarded: OdcAnalysisMetric;
    rejectedOrWithdrawn: OdcAnalysisMetric;
  };
  todayInterviewStates: {
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
  from?: string;
  jdIds?: string;
  to?: string;
}

function optionalSearchString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function coerceOdcAnalysisSearch(search: Record<string, unknown>): OdcAnalysisSearch {
  const candidate = {
    from: optionalSearchString(search.from),
    jdIds: optionalSearchString(search.jdIds),
    to: optionalSearchString(search.to),
  };
  const filters = odcAnalysisFiltersSchema.safeParse({
    from: candidate.from,
    jobDescriptionIds: candidate.jdIds?.split(",").filter(Boolean) ?? [],
    to: candidate.to,
  });
  if (!filters.success) {
    return {};
  }
  return {
    from: filters.data.from,
    jdIds:
      filters.data.jobDescriptionIds.length > 0
        ? filters.data.jobDescriptionIds.join(",")
        : undefined,
    to: filters.data.to,
  };
}

export function filtersFromOdcAnalysisSearch(search: OdcAnalysisSearch): OdcAnalysisFilters {
  return odcAnalysisFiltersSchema.parse({
    from: search.from,
    jobDescriptionIds: search.jdIds?.split(",").filter(Boolean) ?? [],
    to: search.to,
  });
}
