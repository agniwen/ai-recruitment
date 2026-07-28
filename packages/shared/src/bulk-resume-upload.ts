import { z } from "zod";
import type {
  ResumeUploadBatchDedupPolicy,
  ResumeUploadBatchItemStatus,
  ResumeUploadBatchJdMode,
  ResumeUploadBatchStatus,
  ResumeUploadBatchTarget,
  ResumePoolScope,
} from "@arc/db-schema/schema";
import { resumeRecruitmentSources } from "@arc/db-schema/resume-recruitment-source";
import type { ResumeRecruitmentSource } from "@arc/db-schema/resume-recruitment-source";
export { resumeRecruitmentSources } from "@arc/db-schema/resume-recruitment-source";
export type { ResumeRecruitmentSource } from "@arc/db-schema/resume-recruitment-source";

export const MAX_BULK_BATCH_SIZE = 100;
export const MAX_RESUME_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_RESUME_PARSE_STALE_PROCESSING_SECONDS = 15 * 60;

export const resumeRecruitmentSourceSchema = z.enum(resumeRecruitmentSources);

export const resumeRecruitmentSourceMeta: Record<
  ResumeRecruitmentSource,
  { detailLabel: string | null; detailPlaceholder: string | null; label: string }
> = {
  boss: { detailLabel: null, detailPlaceholder: null, label: "Boss直聘" },
  liepin: { detailLabel: null, detailPlaceholder: null, label: "猎聘" },
  other: {
    detailLabel: "其他来源",
    detailPlaceholder: "请输入具体简历来源",
    label: "其他",
  },
  referral: { detailLabel: "推荐人", detailPlaceholder: "请输入推荐人", label: "内推" },
  tg: { detailLabel: null, detailPlaceholder: null, label: "TG" },
  xiaohongshu: { detailLabel: null, detailPlaceholder: null, label: "小红书" },
  zhilian: { detailLabel: null, detailPlaceholder: null, label: "智联招聘" },
};

// /uploads 单文件返回。
// /uploads single-file return shape.
export interface BulkResumeUploadFileDescriptor {
  storageKey: string;
  contentHash: string;
  originalFileName: string;
  fileSize: number;
}

// POST / 创建 batch 请求。
// Create-batch request payload.
export const createBulkResumeBatchSchema = z
  .object({
    dedupPolicy: z.enum(["skip", "create"]),
    files: z
      .array(
        z.object({
          contentHash: z.string().min(1).max(128),
          fileSize: z.number().int().positive().max(MAX_RESUME_FILE_SIZE_BYTES),
          originalFileName: z.string().min(1).max(500),
          storageKey: z.string().min(1),
        }),
      )
      .min(1)
      .max(MAX_BULK_BATCH_SIZE),
    jdMode: z.enum(["bind", "auto", "none"]),
    jobDescriptionId: z.string().min(1).nullable().optional(),
    recruitmentSource: resumeRecruitmentSourceSchema.nullable().optional(),
    recruitmentSourceDetail: z.string().trim().max(500).nullable().optional(),
    resumePoolScope: z.enum(["private", "public"]).nullable().optional(),
    target: z.enum(["resume_library", "resume_pool"]).default("resume_library"),
  })
  .superRefine((value, ctx) => {
    if (value.target === "resume_library" && !value.recruitmentSource) {
      ctx.addIssue({
        code: "custom",
        message: "请选择简历来源",
        path: ["recruitmentSource"],
      });
    }
    const sourceDetailLabel = value.recruitmentSource
      ? resumeRecruitmentSourceMeta[value.recruitmentSource].detailLabel
      : null;
    if (sourceDetailLabel && !value.recruitmentSourceDetail?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: `请输入${sourceDetailLabel}`,
        path: ["recruitmentSourceDetail"],
      });
    }
  });

export type CreateBulkResumeBatchInput = z.input<typeof createBulkResumeBatchSchema>;

export interface BulkResumeBatchDto {
  id: string;
  status: ResumeUploadBatchStatus;
  jdMode: ResumeUploadBatchJdMode;
  jobDescriptionId: string | null;
  recruitmentSource?: ResumeRecruitmentSource | null;
  recruitmentSourceDetail?: string | null;
  dedupPolicy: ResumeUploadBatchDedupPolicy;
  resumePoolScope?: ResumePoolScope | null;
  target?: ResumeUploadBatchTarget;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BulkResumeBatchItemDto {
  id: string;
  batchId: string;
  orderIndex: number;
  originalFileName: string;
  fileSize: number;
  contentHash: string | null;
  status: ResumeUploadBatchItemStatus;
  poolItemId?: string | null;
  resumeRecordId: string | null;
  dedupMatchSnapshot?: unknown;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BulkResumeBatchDetailDto {
  batch: BulkResumeBatchDto;
  items: BulkResumeBatchItemDto[];
}

export interface ProcessNextResult {
  batch: BulkResumeBatchDto;
  item: BulkResumeBatchItemDto | null;
  done: boolean;
}
