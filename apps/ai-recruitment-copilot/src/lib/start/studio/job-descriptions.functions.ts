import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import type { JobDescriptionMetrics } from "@arc/shared/job-descriptions";
import type { JsonValue } from "@/lib/start/server-function-types";
import { resolveWorkspaceAccessFromRequest } from "@/lib/start/auth-session.server";
import { workspaceDataGridInputSchema } from "@/lib/start/server-fn-validators";
import { loadStudioJobDescriptionsData } from "./job-descriptions.server";

export interface JobDescriptionFilters extends Record<string, string> {
  code: string;
  departmentId: string;
  googleSheetStatus: string;
  interviewerId: string;
  recruitmentStatus: string;
  sourceSheet: string;
}

const jobDescriptionFiltersSchema = z.object({
  code: z.string(),
  departmentId: z.string(),
  googleSheetStatus: z.string(),
  interviewerId: z.string(),
  recruitmentStatus: z.string(),
  sourceSheet: z.string(),
});

export type StudioJobDescriptionsState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | {
      departments: DepartmentRecord[];
      dehydratedState: JsonValue;
      interviewers: InterviewerListRecord[];
      metrics: JobDescriptionMetrics;
      recruitmentStatuses: string[];
      sourceSheets: string[];
      status: "ready";
    };

export const loadStudioJobDescriptionsState = createServerFn({ method: "GET" })
  .validator(workspaceDataGridInputSchema(jobDescriptionFiltersSchema))
  .handler(async ({ data }): Promise<StudioJobDescriptionsState> => {
    const access = await resolveWorkspaceAccessFromRequest(data.slug);
    if (access.status !== "ready") {
      return access;
    }

    return {
      ...(await loadStudioJobDescriptionsData({
        actorUserId: access.user.id,
        query: data.query,
        slug: data.slug,
        workspaceId: access.workspace.id,
      })),
      status: "ready",
    };
  });
