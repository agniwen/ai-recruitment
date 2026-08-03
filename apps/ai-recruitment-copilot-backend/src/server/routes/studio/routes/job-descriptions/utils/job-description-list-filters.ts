import { z } from "zod";

const googleSheetStatusSchema = z.enum(["active", "deleted", "unlinked"]);

const jobDescriptionListFiltersSchema = z.object({
  code: z.string().trim().max(120).optional().nullable(),
  departmentId: z.string().trim().max(120).optional().nullable(),
  googleSheetStatus: z.string().trim().max(120).optional().nullable(),
  hiringUnitId: z.string().trim().max(500).optional().nullable(),
  interviewerId: z.string().trim().max(120).optional().nullable(),
  recruitmentStatus: z.string().trim().max(500).optional().nullable(),
  search: z.string().trim().max(120).optional().nullable(),
  sourceSheet: z.string().trim().max(500).optional().nullable(),
});

export type JobDescriptionGoogleSheetStatusFilter = z.infer<typeof googleSheetStatusSchema>;

export interface JobDescriptionListFilterInput {
  code?: string | null;
  departmentId?: string | null;
  googleSheetStatus?: string | null;
  hiringUnitId?: string | null;
  interviewerId?: string | null;
  recruitmentStatus?: string | null;
  search?: string | null;
  sourceSheet?: string | null;
}

function csvToValues(value?: string | null): string[] | undefined {
  if (!value) {
    return;
  }
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function parseEnumCsv<T extends string>(
  value: string | null | undefined,
  schema: z.ZodType<T>,
): T[] | undefined {
  const parsed = csvToValues(value)?.flatMap((entry) => {
    const result = schema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
  return parsed && parsed.length > 0 ? parsed : undefined;
}

export function parseJobDescriptionListFilters(filters?: JobDescriptionListFilterInput) {
  const parsed = jobDescriptionListFiltersSchema.safeParse(filters ?? {});
  if (!parsed.success) {
    return {};
  }
  return {
    code: parsed.data.code?.trim() || undefined,
    departmentIds: csvToValues(parsed.data.departmentId),
    googleSheetStatuses: parseEnumCsv(parsed.data.googleSheetStatus, googleSheetStatusSchema),
    hiringUnitIds: csvToValues(parsed.data.hiringUnitId),
    interviewerIds: csvToValues(parsed.data.interviewerId),
    recruitmentStatuses: csvToValues(parsed.data.recruitmentStatus),
    search: parsed.data.search?.trim() || undefined,
    sourceSheet: parsed.data.sourceSheet?.trim() || undefined,
  };
}
