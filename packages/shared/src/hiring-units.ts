import { z } from "zod";

export const hiringUnitBaseSchema = z.object({
  description: z.string().trim().max(500, "描述不能超过 500 字").optional().or(z.literal("")),
  name: z.string().trim().min(1, "请输入用人组织名称").max(120, "名称不能超过 120 个字符"),
  resumeSourceId: z.string().trim().min(1, "请选择简历来源").nullable().optional(),
});

export const hiringUnitFormSchema = hiringUnitBaseSchema;
export const hiringUnitUpdateSchema = hiringUnitBaseSchema;

export type HiringUnitFormValues = z.infer<typeof hiringUnitFormSchema>;
export type HiringUnitUpdateValues = z.infer<typeof hiringUnitUpdateSchema>;

export interface HiringUnitRecord {
  resumeSourceId?: string | null;
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type HiringUnitListRecord = HiringUnitRecord;

export interface OdcMemberSummary {
  email: string;
  image: string | null;
  memberId: string;
  name: string;
  userId: string;
}

export const odcJobSeriesValues = ["直属", "派驻"] as const;
export type OdcJobSeries = (typeof odcJobSeriesValues)[number];

export interface OdcAssignmentSummary extends OdcMemberSummary {
  canApproveAiReview?: boolean;
  jobSeries: OdcJobSeries | null;
  serviceUnit: string | null;
}

export interface OdcManagedAssignment extends OdcAssignmentSummary {
  createdAt: string | Date;
}

export interface PaginatedOdcAssignmentResult {
  assignedMemberIds: string[];
  page: number;
  pageSize: number;
  records: OdcManagedAssignment[];
  total: number;
  totalPages: number;
}

export interface HiringUnitTreeDepartment {
  createdAt: string | Date;
  description: string | null;
  hiringUnitId: string | null;
  id: string;
  interviewerCount: number;
  jobDescriptionCount: number;
  name: string;
  odcMembers: OdcAssignmentSummary[];
  updatedAt: string | Date;
}

export interface HiringUnitTreeNode extends HiringUnitRecord {
  departments: HiringUnitTreeDepartment[];
  odcMembers: OdcAssignmentSummary[];
}

export interface HiringUnitTreeResult {
  records: HiringUnitTreeNode[];
  unassignedDepartments: HiringUnitTreeDepartment[];
}

const odcAssignmentItemSchema = z.object({
  canApproveAiReview: z.boolean().optional(),
  jobSeries: z.enum(odcJobSeriesValues).nullable().optional(),
  memberId: z.string().trim().min(1),
  serviceUnit: z.string().trim().max(120, "服务单位不能超过 120 个字符").nullable().optional(),
});

export const odcAssignmentCreateSchema = odcAssignmentItemSchema.strict();
export type OdcAssignmentCreateInput = z.infer<typeof odcAssignmentCreateSchema>;

export const odcAssignmentUpdateSchema = odcAssignmentItemSchema.omit({ memberId: true }).strict();
export type OdcAssignmentUpdateInput = z.infer<typeof odcAssignmentUpdateSchema>;

export const odcAssignmentSchema = z.object({
  assignments: z
    .array(odcAssignmentItemSchema)
    .refine(
      (items) => new Set(items.map((item) => item.memberId)).size === items.length,
      "ODC 人员不能重复",
    ),
});

export const odcAssignmentBatchCreateSchema = odcAssignmentSchema
  .extend({
    assignments: odcAssignmentSchema.shape.assignments.min(1, "请至少选择一名 ODC 人员"),
  })
  .strict();

export type OdcAssignmentInput = z.infer<typeof odcAssignmentSchema>;
export type OdcAssignmentItem = OdcAssignmentInput["assignments"][number];

export const odcBatchAssignmentSchema = z.object({
  assignments: odcAssignmentSchema.shape.assignments,
  targets: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        rowType: z.enum(["hiringUnit", "department"]),
      }),
    )
    .min(1, "请至少选择一个用人组织或部门")
    .refine(
      (targets) =>
        new Set(targets.map((target) => `${target.rowType}:${target.id}`)).size === targets.length,
      "用人组织或部门不能重复",
    ),
});

export type OdcBatchAssignmentInput = z.infer<typeof odcBatchAssignmentSchema>;
export type OdcBatchAssignmentTarget = OdcBatchAssignmentInput["targets"][number];
