import { createServerFn } from "@tanstack/react-start";
import { resolveAuthorizedStudioPageAccessFromRequest } from "./page-access.server";
import {
  emptyFiltersSchema,
  platformDataGridInputSchema,
  slugInputSchema,
} from "@/lib/start/server-fn-validators";
import type { JsonValue } from "@/lib/start/server-function-types";
import { loadStudioPreRegistrationsHydrationState } from "./pre-registrations.server";

export type StudioPreRegistrationsState =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { dehydratedState: JsonValue; status: "ready" };

export const loadStudioPreRegistrationsState = createServerFn({ method: "GET" })
  .validator(platformDataGridInputSchema(emptyFiltersSchema).extend(slugInputSchema.shape))
  .handler(async ({ data }): Promise<StudioPreRegistrationsState> => {
    const adminState = await resolveAuthorizedStudioPageAccessFromRequest(
      data.slug,
      "preRegistrations",
    );
    if (adminState.status !== "ready") {
      return adminState;
    }
    return {
      dehydratedState: await loadStudioPreRegistrationsHydrationState(data.slug, data.query),
      status: "ready",
    };
  });
