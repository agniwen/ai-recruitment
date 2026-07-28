import type { MinimaxVoiceId } from "@arc/db-schema/minimax-voices";
import { z } from "zod";
import type { ResumeParseStatus } from "@arc/db-schema/studio-interviews";
import {
  createDefaultResumeScreeningPolicy,
  resumeScreeningPolicySchema,
} from "./resume-screening";
import type { ResumeScreeningPolicy } from "./resume-screening";
import type { ResumePoolProfileHighlights } from "./resume-pool";

export const jobDescriptionCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => value === "" || /^[A-Z0-9]{12,23}$/.test(value), "岗位编码格式无效")
  .transform((value) => value || undefined)
  .optional();

const nullableSalaryAmountSchema = z
  .number()
  .int("薪资金额必须为整数")
  .min(0, "薪资金额不能为负")
  .nullable()
  .optional();
const nullableSalaryCurrencySchema = z
  .string()
  .trim()
  .min(1, "请选择薪资币种")
  .max(8, "薪资币种不能超过 8 个字符")
  .nullable()
  .optional();
const nullableTextSchema = (max: number, label: string) =>
  z.string().trim().max(max, `${label}不能超过 ${max} 个字符`).nullable().optional();
const nullableCountSchema = (label: string) =>
  z.number().int(`${label}必须为整数`).min(0, `${label}不能为负`).nullable().optional();
const nullableDateStringSchema = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}格式无效`)
    .nullable()
    .optional();
const nullableTimeSchema = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), {
      message: `${label}格式无效`,
    })
    .nullable()
    .optional();

export const jobDescriptionPrioritySchema = z.enum(["P0", "P1", "P2"]);
export type JobDescriptionPriority = z.infer<typeof jobDescriptionPrioritySchema>;

function validateWorkSchedule(
  value: {
    workEndTime?: string | null;
    workStartTime?: string | null;
    workTimezone?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const hasWorkSchedule = Boolean(
    value.workStartTime?.trim() || value.workEndTime?.trim() || value.workTimezone?.trim(),
  );
  if (!hasWorkSchedule) {
    return;
  }
  if (!value.workStartTime?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "请选择工作开始时间",
      path: ["workStartTime"],
    });
  }
  if (!value.workEndTime?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "请选择工作结束时间",
      path: ["workEndTime"],
    });
  }
  if (!value.workTimezone?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "请输入工作时区",
      path: ["workTimezone"],
    });
  }
}

function validateSalaryRange(
  value: {
    salaryCurrency?: string | null;
    salaryMaxAmount?: number | null;
    salaryMinAmount?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  const hasSalary =
    (value.salaryMinAmount !== null && value.salaryMinAmount !== undefined) ||
    (value.salaryMaxAmount !== null && value.salaryMaxAmount !== undefined) ||
    Boolean(value.salaryCurrency?.trim());
  if (!hasSalary) {
    return;
  }
  if (value.salaryMinAmount === null || value.salaryMinAmount === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "请输入薪资下限",
      path: ["salaryMinAmount"],
    });
  }
  if (value.salaryMaxAmount === null || value.salaryMaxAmount === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "请输入薪资上限",
      path: ["salaryMaxAmount"],
    });
  }
  if (!value.salaryCurrency?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "请选择薪资币种",
      path: ["salaryCurrency"],
    });
  }
  if (
    value.salaryMinAmount !== null &&
    value.salaryMinAmount !== undefined &&
    value.salaryMaxAmount !== null &&
    value.salaryMaxAmount !== undefined &&
    value.salaryMaxAmount < value.salaryMinAmount
  ) {
    ctx.addIssue({
      code: "custom",
      message: "薪资上限不能低于下限",
      path: ["salaryMaxAmount"],
    });
  }
}

export const jobDescriptionBaseSchema = z
  .object({
    aiInterviewDisabled: z.boolean(),
    allowCrossDepartmentInterviewers: z.boolean(),
    code: jobDescriptionCodeSchema,
    controlCategory: nullableTextSchema(120, "岗位管控分类"),
    departmentId: z.string().trim().min(1, "请选择所属部门"),
    description: z.string().trim().max(500, "描述不能超过 500 字").optional().or(z.literal("")),
    expectedOnboardDate: nullableDateStringSchema("期望到岗日期"),
    gapCount: nullableCountSchema("缺口"),
    headcount: nullableCountSchema("HC"),
    humanInterviewerIds: z.array(z.string().trim().min(1)).max(20),
    interviewerIds: z
      .array(z.string().trim().min(1))
      .min(1, "请至少选择一位面试官")
      .max(20, "最多只能选择 20 位面试官"),
    jobLevel: nullableTextSchema(80, "职级"),
    jobSeries: nullableTextSchema(120, "序列"),
    name: z.string().trim().min(1, "请输入岗位名称").max(120, "岗位名称不能超过 120 个字符"),
    notes: nullableTextSchema(2000, "备注说明"),
    offeredPendingOnboardCount: nullableCountSchema("已发 offer 待入职"),
    onboardedCount: nullableCountSchema("已到岗"),
    priority: jobDescriptionPrioritySchema,
    prompt: z.string().trim().min(1, "请输入岗位 prompt").max(10_000, "prompt 不能超过 10000 字"),
    recruitmentStatus: nullableTextSchema(120, "招聘状态"),
    requestedDate: nullableDateStringSchema("提需日期"),
    requester: nullableTextSchema(500, "需求发起人"),
    resumeContact: nullableTextSchema(500, "简历对接人"),
    resumeScreeningPolicy: resumeScreeningPolicySchema,
    salaryCurrency: nullableSalaryCurrencySchema,
    salaryMaxAmount: nullableSalaryAmountSchema,
    salaryMinAmount: nullableSalaryAmountSchema,
    serviceUnit: nullableTextSchema(120, "服务单位"),
    sourceSheet: nullableTextSchema(120, "来源表格"),
    workEndTime: nullableTimeSchema("工作结束时间"),
    workLocation: nullableTextSchema(120, "工作地点"),
    workStartTime: nullableTimeSchema("工作开始时间"),
    workTimezone: nullableTextSchema(100, "工作时区"),
  })
  .superRefine((value, ctx) => {
    validateWorkSchedule(value, ctx);
    validateSalaryRange(value, ctx);
  });

export const jobDescriptionFormSchema = jobDescriptionBaseSchema;
export const jobDescriptionUpdateSchema = jobDescriptionBaseSchema;

export type JobDescriptionFormValues = z.infer<typeof jobDescriptionFormSchema>;
export type JobDescriptionUpdateValues = z.infer<typeof jobDescriptionUpdateSchema>;

export { createDefaultResumeScreeningPolicy };

export interface JobDescriptionInterviewerSummary {
  id: string;
  name: string;
  voice: MinimaxVoiceId;
}

export interface JobDescriptionRecord {
  id: string;
  allowCrossDepartmentInterviewers: boolean;
  aiInterviewDisabled: boolean;
  code: string | null;
  controlCategory: string | null;
  departmentId: string;
  interviewerIds: string[];
  name: string;
  description: string | null;
  expectedOnboardDate: string | null;
  gapCount: number | null;
  headcount: number | null;
  humanInterviewerIds: string[];
  jobLevel: string | null;
  jobSeries: string | null;
  notes: string | null;
  offeredPendingOnboardCount: number | null;
  onboardedCount: number | null;
  priority: JobDescriptionPriority;
  /** @deprecated Replaced by interview-question-templates. Read for legacy data only. */
  presetQuestions: string[];
  prompt: string;
  recruitmentStatus: string | null;
  requestedDate: string | null;
  requester: string | null;
  resumeContact: string | null;
  salaryCurrency: string | null;
  salaryMaxAmount: number | null;
  salaryMinAmount: number | null;
  serviceUnit: string | null;
  sourceSheet: string | null;
  workEndTime: string | null;
  workLocation: string | null;
  workStartTime: string | null;
  workTimezone: string | null;
  resumeScreeningPolicy: ResumeScreeningPolicy;
  resumeScreeningPolicyHash: string | null;
  resumeScreeningPolicyVersion: number;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface JobDescriptionListRecord extends JobDescriptionRecord {
  departmentName: string | null;
  interviewers: JobDescriptionInterviewerSummary[];
  // 非归档候选人 / 简历计数；用于列表"简历关联"列。
  // Non-archived candidate count; powers the "resume association" column.
  resumeCount: number;
}

/**
 * 在招岗位管理页头部 chart 的聚合数据。
 * - candidatesByJd：各岗位非归档候选人数 Top 8。
 * - completionByJd：各岗位面试轮次完成率 Top 8（仅纳入存在 schedule 的 JD）。
 * - loadByInterviewer：每位面试官当前承接的进行中 / 待面试候选人数 Top 8。
 *
 * Aggregations for the charts shown above the JD management table.
 * - candidatesByJd: top 8 JDs by non-archived candidate count.
 * - completionByJd: top 8 JDs by completed-rounds / total-rounds ratio; only
 *   JDs whose candidates have schedule rows are included.
 * - loadByInterviewer: top 8 interviewers by active (ready / in_progress)
 *   candidate count, summed across all JDs they are assigned to.
 */
export interface JobDescriptionMetrics {
  candidatesByJd: { id: string; name: string; count: number }[];
  completionByJd: { id: string; name: string; done: number; total: number }[];
  loadByInterviewer: { id: string; name: string; activeCandidates: number }[];
}

export interface JobDescriptionTalentRecommendation {
  candidateEmail: string | null;
  candidateName: string;
  candidatePhone: string | null;
  createdAt: string;
  currentJobDescriptionId: string | null;
  currentJobDescriptionName: string | null;
  id: string;
  masteredSkills: string[];
  notes: string | null;
  profileHighlights: ResumePoolProfileHighlights;
  reasons: string[];
  resumeFileName: string | null;
  resumeParseStatus: ResumeParseStatus;
  score: number;
  similarity: {
    resumeOverview?: number;
    skillRole?: number;
    workProject?: number;
  };
  targetRole: string | null;
  workYears: number | null;
}

export interface JobDescriptionTalentRecommendationResult {
  candidates: JobDescriptionTalentRecommendation[];
  diagnostics: {
    vectorHitCount: number;
  };
  jobDescription: {
    id: string;
    name: string;
  };
  status: "disabled" | "ready";
}

export interface JobDescriptionRecommendation {
  departmentName: string | null;
  description: string | null;
  id: string;
  name: string;
  reasons: string[];
  score: number;
  similarity: { resumeOverview?: number; skillRole?: number; workProject?: number };
}

export interface JobDescriptionRecommendationResult {
  diagnostics: { aboveThresholdCount: number; eligibleCount: number; vectorHitCount: number };
  recommendations: JobDescriptionRecommendation[];
  resume: { id: string };
  status: "disabled" | "ready" | "already_matched" | "indexing";
}
