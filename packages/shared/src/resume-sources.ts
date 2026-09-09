import { z } from "zod";
import type { OdcAssignmentSummary } from "./hiring-units";

export const resumeSourceFormSchema = z.object({
  description: z.string().trim().max(500, "描述不能超过 500 字").optional(),
  name: z.string().trim().min(1, "请输入部门/中心（来源）名称").max(120, "名称不能超过 120 个字符"),
});
export type ResumeSourceFormValues = z.infer<typeof resumeSourceFormSchema>;
export interface ResumeSourceRecord {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  hiringUnitCount: number;
  departmentCount: number;
  jobDescriptionCount: number;
  odcMembers: OdcAssignmentSummary[];
}
