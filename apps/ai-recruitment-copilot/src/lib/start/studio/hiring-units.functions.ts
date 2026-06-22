import { createServerFn } from "@tanstack/react-start";
import type { JsonValue } from "@/lib/start/server-function-types";
import { resolveWorkspaceAccessFromRequest } from "@/lib/start/auth-session.server";
import { emptyFiltersSchema, workspaceDataGridInputSchema } from "@/lib/start/server-fn-validators";
import { loadStudioHiringUnitsHydrationState } from "./hiring-units.server";

export type StudioHiringUnitsState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | {
      dehydratedState: JsonValue;
      status: "ready";
    };

export const loadStudioHiringUnitsState = createServerFn({ method: "GET" })
  .validator(workspaceDataGridInputSchema(emptyFiltersSchema))
  .handler(async ({ data }): Promise<StudioHiringUnitsState> => {
    const access = await resolveWorkspaceAccessFromRequest(data.slug);
    if (access.status !== "ready") {
      return access;
    }

    return {
      dehydratedState: await loadStudioHiringUnitsHydrationState({
        query: data.query,
        slug: data.slug,
        workspaceId: access.workspace.id,
      }),
      status: "ready",
    };
  });
