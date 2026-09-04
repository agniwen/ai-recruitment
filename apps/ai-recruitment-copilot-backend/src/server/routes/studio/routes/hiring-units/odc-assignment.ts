import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, organizationRole, user } from "@arc/db-schema/schema";
import type { OdcMemberSummary } from "@arc/shared/hiring-units";
import { canAssignOdcMembers } from "./odc-assignment-policy";
import type { OdcAssignmentIdentity } from "./odc-assignment-policy";

const ODC_MEMBER_QUERY_BATCH_SIZE = 5000;

export async function listOdcMemberCandidates(organizationId: string): Promise<OdcMemberSummary[]> {
  const rows = await db
    .select({
      email: user.email,
      image: user.image,
      memberId: member.id,
      name: user.name,
      userId: user.id,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
        eq(organizationRole.isOdc, true),
      ),
    )
    .where(eq(member.organizationId, organizationId))
    .orderBy(user.name, user.email);

  return rows;
}

export async function areEligibleOdcMembers({
  memberIds,
  organizationId,
}: OdcAssignmentIdentity): Promise<boolean> {
  if (memberIds.length === 0) {
    return true;
  }

  const candidates = [];
  for (let index = 0; index < memberIds.length; index += ODC_MEMBER_QUERY_BATCH_SIZE) {
    const rows = await db
      .select({
        isOdc: organizationRole.isOdc,
        memberId: member.id,
        organizationId: member.organizationId,
      })
      .from(member)
      .innerJoin(
        organizationRole,
        and(
          eq(organizationRole.organizationId, member.organizationId),
          eq(organizationRole.role, member.role),
        ),
      )
      .where(
        and(
          inArray(member.id, memberIds.slice(index, index + ODC_MEMBER_QUERY_BATCH_SIZE)),
          eq(member.organizationId, organizationId),
        ),
      );
    candidates.push(...rows);
  }

  return canAssignOdcMembers({ memberIds, organizationId }, candidates);
}
