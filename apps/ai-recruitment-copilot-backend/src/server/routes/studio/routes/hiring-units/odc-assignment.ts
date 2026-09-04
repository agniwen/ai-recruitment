import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, organizationRole, user } from "@arc/db-schema/schema";
import type { OdcMemberSummary } from "@arc/shared/hiring-units";
import { canAssignOdcMember } from "./odc-assignment-policy";
import type { OdcAssignmentIdentity } from "./odc-assignment-policy";

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

export async function isEligibleOdcMember({
  memberId,
  organizationId,
}: OdcAssignmentIdentity): Promise<boolean> {
  const [candidate] = await db
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
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1);

  return candidate ? canAssignOdcMember({ memberId, organizationId }, candidate) : false;
}
