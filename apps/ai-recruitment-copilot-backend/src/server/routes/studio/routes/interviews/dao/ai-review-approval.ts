import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member } from "@arc/db-schema/schema";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";

type Executor = Pick<typeof db, "select">;

export async function canApproveCandidateAiReview(
  input: { organizationId: string; userId: string | null },
  executor: Executor = db,
): Promise<boolean> {
  if (!input.userId) {
    return false;
  }
  const [actor] = await executor
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1);
  const authorize = createRequestWorkspaceAuthorizer({
    memberRole: actor?.role,
    organizationId: input.organizationId,
    userId: input.userId,
  });
  return await authorize({ action: "approve", resource: "aiReview" });
}
