import { z } from "zod";
import { odcAnalysisFiltersSchema } from "@arc/shared/odc-analysis";

export const odcAnalysisQuerySchema = z
  .object({
    from: z.string().optional(),
    jobDescriptionIds: z.string().optional(),
    role: z.string().optional(),
    to: z.string().optional(),
  })
  .transform((value) =>
    odcAnalysisFiltersSchema.parse({
      from: value.from,
      jobDescriptionIds: value.jobDescriptionIds?.split(",").filter(Boolean) ?? [],
      role: value.role,
      to: value.to,
    }),
  );
