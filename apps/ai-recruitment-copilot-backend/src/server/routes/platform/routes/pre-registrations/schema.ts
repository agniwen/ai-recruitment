import { z } from "zod";

export const preRegistrationRecruitingRoleSchema = z.enum([
  "recruitingSupervisor",
  "recruitingLead",
  "hr",
]);

export const platformPreRegistrationInputSchema = z.object({
  directManagerId: z.string().trim().min(1).nullable(),
  displayName: z.string().trim().min(1, "请输入花名。").max(100),
  email: z.string().trim().email("请输入有效邮箱。"),
  recruitingGroupNames: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  recruitingRole: preRegistrationRecruitingRoleSchema,
  telegram: z.string().trim().min(1, "请输入 TG 号。").max(120),
});

export const platformPreRegistrationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(["displayName", "email", "createdAt"]).default("displayName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type PlatformPreRegistrationInput = z.infer<typeof platformPreRegistrationInputSchema>;
export type PreRegistrationRecruitingRole = z.infer<typeof preRegistrationRecruitingRoleSchema>;
