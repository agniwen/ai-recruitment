import type { JobDescriptionListRecord } from "./job-descriptions";
import { z } from "zod";
import type { ResumeParseStatus } from "@arc/db-schema/studio-interviews";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { ResumeEducationDisplayItem } from "./resume-education";
import type { ResumeDuplicateMatchSummary } from "./resume-duplicates";
import type { ResumePoolScope, ResumePoolStatus } from "@arc/db-schema/schema";
import type { ResumeRecruitmentSource } from "@arc/db-schema/resume-recruitment-source";
import type { ResumeLibraryProfileSnapshot } from "./studio-resumes";

export const resumePoolScopeSchema = z.enum(["private", "public"]);
export const resumePoolStatusSchema = z.enum(["active", "archived"]);

export const resumePoolCreateSchema = z.object({
  candidateEmail: z.string().trim().max(200).nullable().optional(),
  candidateName: z.string().trim().max(120).nullable().optional(),
  candidatePhone: z.string().trim().max(40).nullable().optional(),
  jobDescriptionId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  scope: resumePoolScopeSchema,
  targetRole: z.string().trim().max(120).nullable().optional(),
});

export const resumePoolImportSchema = z.object({
  dedupPolicy: z.enum(["check", "force"]).default("check"),
  hiringUnitId: z.preprocess((value) => value ?? "", z.string().trim().min(1, "请选择入库组织")),
  jobDescriptionId: z.string().trim().min(1).nullable().optional(),
  jobDescriptionMode: z.enum(["none", "bind"]).default("none"),
  recommendationText: z.string().trim().max(2000, "推荐理由不能超过 2000 字").default(""),
  reimport: z.boolean().optional(),
});

export type ResumePoolCreateInput = z.infer<typeof resumePoolCreateSchema>;
export type ResumePoolImportInput = z.infer<typeof resumePoolImportSchema>;

export interface ResumePoolLatestExperienceDetail {
  period: string | null;
  role: string | null;
  summary: string | null;
}

export interface ResumePoolProfileHighlights {
  educationItems: ResumeEducationDisplayItem[];
  educationLines: string[];
  latestCompany: string | null;
  latestCompanyDetail: ResumePoolLatestExperienceDetail | null;
  latestProject: string | null;
  latestProjectDetail: ResumePoolLatestExperienceDetail | null;
  schools: string[];
}

export interface ResumePoolImportedRecord {
  creatorImage: string | null;
  creatorName: string | null;
  importedAt: string;
  resumeRecordId: string;
}

export type ResumePoolSourceChannel = "historical_import" | "mail_ingest" | "referral";

export interface ResumePoolListRecord {
  id: string;
  scope: ResumePoolScope;
  status: ResumePoolStatus;
  organizationId: string | null;
  createdBy: string | null;
  uploaderEmail: string | null;
  uploaderImage: string | null;
  uploaderName: string | null;
  uploaderOrganizationName: string | null;
  sourcePoolItemId: string | null;
  sourceOrganizationId: string | null;
  sourceUserId: string | null;
  sourceChannel: ResumePoolSourceChannel | null;
  publishedAt: string | null;
  publishedBy: string | null;
  recruitmentSource: ResumeRecruitmentSource | null;
  recruitmentSourceDetail: string | null;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  targetRole: string | null;
  notes: string | null;
  jobDescriptionId: string | null;
  jobDescriptionName: string | null;
  resumeFileName: string | null;
  resumeStorageKey: string | null;
  resumeContentHash: string | null;
  resumeParseStatus: ResumeParseStatus;
  resumeParseRetryable: boolean;
  resumeParseError: string | null;
  resumeParsedAt: string | null;
  workYears: number | null;
  masteredSkills: string[];
  profileHighlights: ResumePoolProfileHighlights;
  resumeProfileSnapshot: ResumeLibraryProfileSnapshot;
  skillsNormalized: string[];
  createdAt: string;
  updatedAt: string;
  importedResumeRecordId: string | null;
  importedAt: string | null;
  importedRecords: ResumePoolImportedRecord[];
  duplicateMatch: ResumeDuplicateMatchSummary | null;
}

export interface ResumePoolDetail extends ResumePoolListRecord {
  resumeProfile: ResumeProfile | null;
}

export interface PaginatedResumePoolResult {
  page: number;
  pageSize: number;
  records: ResumePoolListRecord[];
  total: number;
  totalPages: number;
}

export interface ResumePoolUploaderOption {
  email: string;
  id: string;
  image: string | null;
  name: string;
}

export interface ResumePoolImportSuccessResult {
  resumeRecordId: string;
  status: "imported";
}

export interface ResumePoolImportDuplicateMatchRecord {
  candidateEmail: string | null;
  candidateName: string;
  candidatePhone: string | null;
  conflictingSignals?: string[];
  createdAt: string;
  id: string;
  jobDescriptionName: string | null;
  level?: "high" | "low" | "medium";
  resumeProfileSnapshot?: ResumeLibraryProfileSnapshot | null;
  skills?: string[];
  score?: number;
  semanticReasons?: string[];
  similarity?: {
    resumeOverview?: number;
    skillRole?: number;
    workProject?: number;
  };
  status: "active" | "archived";
  targetRole: string | null;
}

export interface ResumePoolImportDuplicateResult {
  matches: ResumePoolImportDuplicateMatchRecord[];
  status: "duplicate_found";
}

export type ResumePoolImportResult =
  | ResumePoolImportDuplicateResult
  | ResumePoolImportSuccessResult;

export const resumePoolScopeMeta: Record<ResumePoolScope, { label: string }> = {
  private: { label: "私有简历池" },
  public: { label: "公共简历池" },
};

export const resumePoolImportDestinationSchema = z.object({
  departmentId: z.string().trim().min(1).nullable().default(null),
  hiringUnitId: z.string().trim().min(1),
  jobDescriptionId: z.string().trim().min(1).nullable().default(null),
  serviceUnit: z.string().trim().max(200).nullable().default(null),
});

export const resumePoolBatchImportSchema = z
  .object({
    dedupPolicy: z.enum(["check", "force"]).default("check"),
    destinations: z
      .array(resumePoolImportDestinationSchema)
      .min(1, "请选择入库组织")
      .max(50)
      .refine(
        (rows) => new Set(rows.map((row) => row.hiringUnitId)).size === rows.length,
        "入库组织不能重复",
      ),
    jobDescriptionMode: z.enum(["none", "bind"]),
    recommendationText: z.string().trim().max(2000).default(""),
    requestId: z.uuid(),
  })
  .superRefine((value, ctx) => {
    for (const [index, destination] of value.destinations.entries()) {
      if (value.jobDescriptionMode === "bind" && !destination.jobDescriptionId) {
        ctx.addIssue({
          code: "custom",
          message: "请选择各组织对应的岗位去向",
          path: ["destinations", index, "jobDescriptionId"],
        });
      }
      if (value.jobDescriptionMode === "none" && destination.jobDescriptionId) {
        ctx.addIssue({
          code: "custom",
          message: "不绑定岗位时不能指定岗位",
          path: ["destinations", index, "jobDescriptionId"],
        });
      }
    }
  });
export type ResumePoolImportDestination = z.infer<typeof resumePoolImportDestinationSchema>;
export type ResumePoolBatchImportInput = z.infer<typeof resumePoolBatchImportSchema>;
export interface ResumePoolImportOptions {
  departments: { id: string; name: string; hiringUnitId: string | null }[];
  hiringUnits: { id: string; name: string }[];
  jobDescriptions: JobDescriptionListRecord[];
}
export type ResumePoolBatchImportResult =
  | ResumePoolImportDuplicateResult
  | {
      status: "imported";
      records: { resumeRecordId: string; jobDescriptionId: string | null }[];
    };
