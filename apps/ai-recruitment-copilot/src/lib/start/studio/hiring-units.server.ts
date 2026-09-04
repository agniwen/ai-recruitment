import { dehydrate } from "@tanstack/react-query";
import type { JsonValue } from "@/lib/start/server-function-types";
import { createQueryClient } from "@arc/shared/query-client";
import { listHiringUnitTree } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";

export async function loadStudioHiringUnitsHydrationState({
  slug,
  userId,
  workspaceId,
}: {
  slug: string;
  userId: string;
  workspaceId: string;
}): Promise<JsonValue> {
  const queryClient = createQueryClient();
  await queryClient.prefetchQuery({
    queryFn: () => listHiringUnitTree({ actorUserId: userId, organizationId: workspaceId }),
    queryKey: ["hiring-units", slug, "tree"],
  });

  return structuredClone(dehydrate(queryClient)) as unknown as JsonValue;
}
