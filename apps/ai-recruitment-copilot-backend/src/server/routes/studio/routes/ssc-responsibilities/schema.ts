import { z } from "zod";

export const sscResponsibilityInputSchema = z.object({
  centerName: z.string().trim().min(1, "请输入中心/部门。").max(200),
  demandOwner: z.string().trim().max(100),
  email: z
    .string()
    .trim()
    .max(254)
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.string().email("请输入有效的 SSC 邮箱。")])),
  notes: z.string().trim().max(4000),
  sscName: z.string().trim().max(100),
  telegram: z.string().trim().max(120),
});

export const sscResponsibilitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(300).optional(),
  sortBy: z.enum(["centerName", "sscName", "email", "createdAt"]).default("centerName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type SscResponsibilityInput = z.infer<typeof sscResponsibilityInputSchema>;
export type SscResponsibilitiesQuery = z.infer<typeof sscResponsibilitiesQuerySchema>;
