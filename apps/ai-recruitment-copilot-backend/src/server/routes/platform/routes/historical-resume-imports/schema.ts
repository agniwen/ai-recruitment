import { z } from "zod";

export const historicalResumeImportFilterSchema = z.object({
  view: z.enum(["records", "failed"]).default("records"),
});

export const historicalResumeImportQuerySchema = historicalResumeImportFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
});

export type HistoricalResumeImportFilters = z.infer<typeof historicalResumeImportFilterSchema> &
  Record<string, string>;
export type HistoricalResumeImportQuery = z.infer<typeof historicalResumeImportQuerySchema>;
