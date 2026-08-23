import { z } from "zod";
import { odcAnalysisFiltersSchema } from "@arc/shared/odc-analysis";

export const odcAnalysisQuerySchema = z
  .object({
    activityDate: z.string().optional(),
    activityJobDescriptionIds: z.string().optional(),
    demandDateField: z.string().optional(),
    demandFrom: z.string().optional(),
    demandTo: z.string().optional(),
    progressFrom: z.string().optional(),
    progressJobDescriptionIds: z.string().optional(),
    progressTo: z.string().optional(),
  })
  .transform((value) =>
    odcAnalysisFiltersSchema.parse({
      activityDate: value.activityDate,
      activityJobDescriptionIds: value.activityJobDescriptionIds?.split(",").filter(Boolean) ?? [],
      demandDateField: value.demandDateField,
      demandFrom: value.demandFrom,
      demandTo: value.demandTo,
      progressFrom: value.progressFrom,
      progressJobDescriptionIds: value.progressJobDescriptionIds?.split(",").filter(Boolean) ?? [],
      progressTo: value.progressTo,
    }),
  );
