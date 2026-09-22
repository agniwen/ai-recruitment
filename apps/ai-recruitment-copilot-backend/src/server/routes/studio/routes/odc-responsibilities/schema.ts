import { z } from "zod";

export const responsibilityInput = z.object({
  center: z.string().trim().min(1).max(200),
  departments: z.string().trim().min(1).max(2000),
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(100).default(""),
});
export const importInput = z.object({ rows: z.array(responsibilityInput).min(1).max(500) });
export const scopeInput = z.object({
  allDepartments: z.boolean(),
  departmentIds: z.array(z.string().min(1)).max(200),
  memberId: z.string().min(1),
  resumeSourceId: z.string().min(1),
});
