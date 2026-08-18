import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { odcAnalysisFiltersSchema } from "@arc/shared/odc-analysis";
import type { OdcAnalysisState } from "@arc/shared/odc-analysis";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import { loadCachedOdcAnalysis } from "./odc-analysis.server";
import { resolveAuthorizedStudioPageAccessFromRequest } from "./page-access.server";

const odcAnalysisInputSchema = z.object({
  filters: odcAnalysisFiltersSchema,
  slug: z.string().min(1),
});

export const loadOdcAnalysisState = createServerFn({ method: "GET" })
  .validator(odcAnalysisInputSchema)
  .handler(async ({ data }): Promise<OdcAnalysisState> => {
    const access = await resolveAuthorizedStudioPageAccessFromRequest(data.slug, "odcAnalysis");
    if (access.status !== "ready") {
      return access;
    }
    const result = await loadCachedOdcAnalysis(access.workspace.id, data.filters);
    return {
      ...result,
      access: {
        canViewResumes: hasPermissionInStatements(access.permissions, "page", "resumes"),
      },
      status: "ready",
    };
  });
