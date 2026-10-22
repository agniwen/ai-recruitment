import { z } from "zod";

const jobScopeFields = {
  departmentId: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .nullable()
    .optional(),
  serviceUnit: z
    .string()
    .trim()
    .max(120)
    .transform((value) => value || null)
    .nullable()
    .optional(),
};

export const sscResponsibilityInputSchema = z.object({
  ...jobScopeFields,
  centerName: z.string().trim().min(1, "请输入中心/部门。").max(200),
  demandOwner: z.string().trim().max(100),
  email: z
    .string()
    .trim()
    .max(254)
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.string().email("请输入有效的 SSC 邮箱。")])),
  notes: z.string().trim().max(4000),
  resumeSourceId: z.string().trim().min(1).max(200).nullable(),
  sscName: z.string().trim().max(100),
  telegram: z.string().trim().max(120),
  workspaceRole: z
    .string()
    .trim()
    .min(1, "请选择 SSC 工作区角色。")
    .max(100)
    .refine((role) => !role.includes(","), "请选择一个 SSC 工作区角色。"),
});

export const sscResponsibilitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  resumeSourceId: z.string().trim().min(1).max(200).optional(),
  search: z.string().max(300).optional(),
  sortBy: z.enum(["centerName", "sscName", "email", "createdAt"]).default("centerName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const sscAssignmentCandidatesQuerySchema = z.object({
  ...jobScopeFields,
  resumeSourceId: z.string().trim().min(1).max(200),
});

export const sscSourceAssignmentInputSchema = z.object({
  ...jobScopeFields,
  candidateIds: z
    .array(
      z
        .string()
        .max(250)
        .regex(/^(member|responsibility):.+$/u),
    )
    .min(1)
    .max(100),
  resumeSourceId: z.string().trim().min(1).max(200),
});

export type SscSourceAssignmentInput = z.infer<typeof sscSourceAssignmentInputSchema>;

export type SscResponsibilityInput = z.infer<typeof sscResponsibilityInputSchema>;
export type SscResponsibilitiesQuery = z.infer<typeof sscResponsibilitiesQuerySchema>;

export const sscResponsibilityImportSchema = z.object({
  rows: z
    .array(
      z.object({
        centerName: z.string().max(10_000),
        demandOwner: z.string().max(10_000),
        departmentName: z.string().max(10_000).optional().default(""),
        email: z.string().max(10_000),
        notes: z.string().max(10_000),
        row: z.number().int().min(2).max(100_000),
        serviceUnit: z.string().max(10_000).optional().default(""),
        sscName: z.string().max(10_000),
        telegram: z.string().max(10_000),
      }),
    )
    .min(1)
    .max(500),
  workspaceRole: z.string().trim().min(1).max(100),
});

export type SscResponsibilityImport = z.input<typeof sscResponsibilityImportSchema>;
export const sscResponsibilityImportCommitSchema = sscResponsibilityImportSchema.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type SscResponsibilityImportCommit = z.input<typeof sscResponsibilityImportCommitSchema>;
