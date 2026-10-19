import { createServerFn } from "@tanstack/react-start";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import {
  emptyFiltersSchema,
  platformDataGridInputSchema,
  slugInputSchema,
} from "@/lib/start/server-fn-validators";
import type { JsonValue } from "@/lib/start/server-function-types";
import { resolveAuthorizedStudioPageAccessFromRequest } from "./page-access.server";
import {
  hasSscResponsibilityAdministratorAccess,
  loadStudioSscResponsibilitiesHydrationState,
} from "./ssc-responsibilities.server";

export type StudioSscResponsibilitiesState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { dehydratedState: JsonValue; status: "ready" };

export const loadStudioSscResponsibilitiesState = createServerFn({ method: "GET" })
  .validator(platformDataGridInputSchema(emptyFiltersSchema).extend(slugInputSchema.shape))
  .handler(async ({ data }): Promise<StudioSscResponsibilitiesState> => {
    const access = await resolveAuthorizedStudioPageAccessFromRequest(
      data.slug,
      "sscResponsibilities",
    );
    if (access.status !== "ready") {
      return access;
    }
    if (!isWorkspaceAdministratorRole(access.member.role)) {
      return { status: "not_found" };
    }
    if (!(await hasSscResponsibilityAdministratorAccess(access.workspace.id, access.user.id))) {
      return { status: "not_found" };
    }
    return {
      dehydratedState: await loadStudioSscResponsibilitiesHydrationState(
        access.workspace.id,
        data.slug,
        data.query,
      ),
      status: "ready",
    };
  });
