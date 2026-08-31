import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { odcAnalysisFiltersSchema } from "@arc/shared/odc-analysis";
import type { OdcAnalysisState } from "@arc/shared/odc-analysis";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import { loadOdcAnalysis } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/odc-analysis/dao";
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
    const result = await loadOdcAnalysis(access.workspace.id, data.filters);
    return {
      ...result,
      access: {
        canViewJobDescriptions: hasPermissionInStatements(
          access.permissions,
          "page",
          "jobDescriptions",
        ),
        canViewResumes: hasPermissionInStatements(access.permissions, "page", "resumes"),
      },
      status: "ready",
    };
  });
