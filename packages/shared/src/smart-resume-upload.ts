import { z } from "zod";
import {
  createBulkResumeBatchSchema,
  MAX_PORTFOLIO_ATTACHMENTS,
  portfolioItemSchema,
  resumeRecruitmentSourceNeedsDetail,
} from "./bulk-resume-upload";
import type { PortfolioItem, ResumeRecruitmentSource } from "./bulk-resume-upload";
import type { SmartRecommendationResult } from "@arc/db-schema/job-matching";

export const createSmartResumeTaskSchema = z
  .object({
    files: createBulkResumeBatchSchema.shape.files,
    recruitmentSource: createBulkResumeBatchSchema.shape.recruitmentSource,
    recruitmentSourceDetail: createBulkResumeBatchSchema.shape.recruitmentSourceDetail,
    requestId: z.string().uuid(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.files.map((file) => file.storageKey)).size !== value.files.length) {
      ctx.addIssue({ code: "custom", message: "同一任务内不能重复上传简历", path: ["files"] });
    }
  });

export const smartResumeSelectionSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        jobDescriptionIds: z
          .array(z.string().min(1))
          .max(10)
          .refine((ids) => new Set(ids).size === ids.length, "岗位不能重复"),
        skipped: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
});

export const smartResumeTaskDraftSchema = z
  .object({
    items: z
      .array(
        smartResumeSelectionSchema.shape.items.element
          .partial({ jobDescriptionIds: true, skipped: true })
          .extend({
            portfolioAttachments: z
              .array(portfolioItemSchema)
              .max(MAX_PORTFOLIO_ATTACHMENTS)
              .optional(),
          })
          .refine(
            (item) =>
              item.jobDescriptionIds !== undefined ||
              item.skipped !== undefined ||
              item.portfolioAttachments !== undefined,
            "请提供需要保存的内容",
          ),
      )
      .min(1)
      .max(100)
      .optional(),
    recruitmentSource: createBulkResumeBatchSchema.shape.recruitmentSource,
    recruitmentSourceDetail: createBulkResumeBatchSchema.shape.recruitmentSourceDetail,
  })
  .refine(
    (value) =>
      value.items !== undefined ||
      value.recruitmentSource !== undefined ||
      value.recruitmentSourceDetail !== undefined,
    "请提供需要保存的内容",
  );

export interface SmartResumeTaskSource {
  recruitmentSource: ResumeRecruitmentSource | null;
  recruitmentSourceDetail: string | null;
}

export function isSmartResumeTaskSourceComplete(source: SmartResumeTaskSource) {
  return Boolean(
    source.recruitmentSource &&
    (!resumeRecruitmentSourceNeedsDetail(source.recruitmentSource) ||
      source.recruitmentSourceDetail?.trim()),
  );
}

export interface SmartResumeTaskItemDto {
  id: string;
  fileName: string;
  portfolioAttachments: PortfolioItem[];
  candidateName: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  result: SmartRecommendationResult | null;
  selectedJobIds: string[];
  skipped: boolean;
  createdRecordIds: string[];
}

export interface SmartResumeTaskDto extends SmartResumeTaskSource {
  id: string;
  createdAt: string;
  submittedAt: string | null;
  items: SmartResumeTaskItemDto[];
}

export interface SmartResumeJobOption {
  id: string;
  name: string;
  departmentName: string | null;
  hiringUnitId: string;
  hiringUnitName: string | null;
  resumeSourceName: string | null;
}

export interface SmartResumeTaskDetail {
  task: SmartResumeTaskDto;
  jobs: SmartResumeJobOption[];
}

export interface SmartResumeTaskSummary {
  id: string;
  createdAt: string;
  total: number;
  ready: number;
  failed: number;
}
