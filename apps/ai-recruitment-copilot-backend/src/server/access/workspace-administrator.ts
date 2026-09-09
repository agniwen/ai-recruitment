import { and, eq } from "drizzle-orm";
import { member } from "@arc/db-schema/schema";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";

export async function isWorkspaceAdministrator(
  organizationId: string,
  userId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  const [actor] = await executor
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return isWorkspaceAdministratorRole(actor?.role);
}
