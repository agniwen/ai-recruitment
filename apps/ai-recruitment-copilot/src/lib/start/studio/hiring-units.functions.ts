import { createServerFn } from "@tanstack/react-start";
import type { JsonValue } from "@/lib/start/server-function-types";
import { slugInputSchema } from "@/lib/start/server-fn-validators";
import { loadStudioHiringUnitsHydrationState } from "./hiring-units.server";
import { resolveAuthorizedStudioPageAccessFromRequest } from "./page-access.server";
import { workspaceAccessHasPermission } from "../auth-session.server";

export type StudioHiringUnitsState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | {
      dehydratedState: JsonValue;
      status: "ready";
    };

export const loadStudioHiringUnitsState = createServerFn({ method: "GET" })
  .validator(slugInputSchema)
  .handler(async ({ data }): Promise<StudioHiringUnitsState> => {
    const access = await resolveAuthorizedStudioPageAccessFromRequest(data.slug, "hiringUnits");
    if (access.status !== "ready") {
      return access;
    }
    if (
      !workspaceAccessHasPermission({ access, action: "read", resource: "hiringUnit" }) ||
      !workspaceAccessHasPermission({ access, action: "read", resource: "department" })
    ) {
      return { status: "not_found" };
    }

    return {
      dehydratedState: await loadStudioHiringUnitsHydrationState({
        slug: data.slug,
        userId: access.user.id,
        workspaceId: access.workspace.id,
      }),
      status: "ready",
    };
  });
