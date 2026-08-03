import { createServerFn } from "@tanstack/react-start";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import type { HiringUnitRecord } from "@arc/shared/hiring-units";
import type { JobDescriptionMetrics } from "@arc/shared/job-descriptions";
import { slugInputSchema } from "@/lib/start/server-fn-validators";
import { loadStudioJobDescriptionsData } from "./job-descriptions.server";
import { resolveAuthorizedStudioPageAccessFromRequest } from "./page-access.server";

export type StudioJobDescriptionsState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | {
      departments: DepartmentRecord[];
      hiringUnits: HiringUnitRecord[];
      interviewers: InterviewerListRecord[];
      metrics: JobDescriptionMetrics;
      recruitmentStatuses: string[];
      sourceSheets: string[];
      status: "ready";
    };

export const loadStudioJobDescriptionsState = createServerFn({ method: "GET" })
  .validator(slugInputSchema)
  .handler(async ({ data }): Promise<StudioJobDescriptionsState> => {
    const access = await resolveAuthorizedStudioPageAccessFromRequest(data.slug, "jobDescriptions");
    if (access.status !== "ready") {
      return access;
    }

    return {
      ...(await loadStudioJobDescriptionsData({
        actorUserId: access.user.id,
        workspaceId: access.workspace.id,
      })),
      status: "ready",
    };
  });
