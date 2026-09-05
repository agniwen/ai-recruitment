import { z } from "zod";

export const preRegistrationRecruitingRoleSchema = z.enum([
  "recruitingSupervisor",
  "recruitingLead",
  "hr",
]);

export const studioPreRegistrationInputSchema = z
  .object({
    directManagerEmail: z.string().trim().email("直属上级邮箱无效。").nullable(),
    displayName: z.string().trim().min(1, "请输入花名。").max(100),
    email: z.string().trim().email("请输入有效邮箱。"),
    recruitingGroupNames: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    recruitingRole: preRegistrationRecruitingRoleSchema,
    telegram: z.string().trim().min(1, "请输入 TG 号。").max(120),
    workspaceRole: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((role) => !role.includes(","), "请选择一个工作区角色。"),
  })
  .refine(
    (input) =>
      !input.directManagerEmail ||
      input.directManagerEmail.toLowerCase() !== input.email.toLowerCase(),
    { message: "不能将自己设置为直属上级。", path: ["directManagerEmail"] },
  );

export const studioPreRegistrationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(["displayName", "email", "createdAt"]).default("displayName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type StudioPreRegistrationInput = z.infer<typeof studioPreRegistrationInputSchema>;
export type PreRegistrationRecruitingRole = z.infer<typeof preRegistrationRecruitingRoleSchema>;
