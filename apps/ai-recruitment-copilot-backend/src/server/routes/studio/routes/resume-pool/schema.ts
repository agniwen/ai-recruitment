import { z } from "zod";
import { resumePoolCreateSchema, resumePoolImportSchema } from "@arc/shared/resume-pool";

export const resumePoolListQuerySchema = z.object({
  id: z.string().trim().max(120).optional(),
  importStatus: z.enum(["imported", "not_imported"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  parseStatus: z.enum(["failed", "processing", "queued", "ready", "unparsed"]).optional(),
  scope: z.enum(["private", "public"]).default("private"),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(["candidateName", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  sourceType: z.enum(["non_referral", "referral"]).optional(),
  uploaderId: z.string().trim().min(1).optional(),
});

export const resumePoolImportInputSchema = resumePoolImportSchema
  .superRefine((value, ctx) => {
    if (value.jobDescriptionMode === "bind" && !value.jobDescriptionId) {
      ctx.addIssue({
        code: "custom",
        message: "绑定岗位时必须选择岗位。",
        path: ["jobDescriptionId"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    jobDescriptionId: value.jobDescriptionMode === "bind" ? (value.jobDescriptionId ?? null) : null,
  }));

export const resumePoolCreateInputSchema = resumePoolCreateSchema;

export const resumePoolBindSchema = z.object({
  jobDescriptionId: z.string().trim().min(1),
});
