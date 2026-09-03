import { createServerFn } from "@tanstack/react-start";
import { getPlatformAdminStateFromRequest } from "@/lib/start/platform-admin.server";
import { emptyFiltersSchema, platformDataGridInputSchema } from "@/lib/start/server-fn-validators";
import type { JsonValue } from "@/lib/start/server-function-types";
import { loadPlatformPreRegistrationsHydrationState } from "./pre-registrations.server";

export type PlatformPreRegistrationsState =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { dehydratedState: JsonValue; status: "ready" };

export const loadPlatformPreRegistrationsState = createServerFn({ method: "GET" })
  .validator(platformDataGridInputSchema(emptyFiltersSchema))
  .handler(async ({ data }): Promise<PlatformPreRegistrationsState> => {
    const adminState = await getPlatformAdminStateFromRequest();
    if (adminState.status !== "ready") {
      return adminState;
    }
    return {
      dehydratedState: await loadPlatformPreRegistrationsHydrationState(data.query),
      status: "ready",
    };
  });
