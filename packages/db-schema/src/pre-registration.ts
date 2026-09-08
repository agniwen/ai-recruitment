import { z } from "zod";

export const preRegistrationOdcAssignmentsSchema = z
  .array(
    z.object({
      jobSeries: z.enum(["直属", "派驻"]).nullable().default(null),
      resumeSourceId: z.string().trim().min(1),
      serviceUnit: z
        .string()
        .trim()
        .max(120, "服务单位不能超过 120 个字符")
        .nullable()
        .default(null),
    }),
  )
  .refine(
    (items) => new Set(items.map((item) => item.resumeSourceId)).size === items.length,
    "简历来源不能重复",
  );

export type PreRegistrationOdcAssignment = z.infer<
  typeof preRegistrationOdcAssignmentsSchema
>[number];
