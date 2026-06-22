import { z } from "zod";

export const hiringUnitBaseSchema = z.object({
  description: z.string().trim().max(500, "描述不能超过 500 字").optional().or(z.literal("")),
  name: z.string().trim().min(1, "请输入用人组织名称").max(120, "名称不能超过 120 个字符"),
});

export const hiringUnitFormSchema = hiringUnitBaseSchema;
export const hiringUnitUpdateSchema = hiringUnitBaseSchema;

export type HiringUnitFormValues = z.infer<typeof hiringUnitFormSchema>;
export type HiringUnitUpdateValues = z.infer<typeof hiringUnitUpdateSchema>;

export interface HiringUnitRecord {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type HiringUnitListRecord = HiringUnitRecord;
