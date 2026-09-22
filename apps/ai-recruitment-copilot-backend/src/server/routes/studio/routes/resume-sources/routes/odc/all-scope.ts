import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, organizationRole, user } from "@arc/db-schema/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listAllSourceOdcMembers(organizationId: string) {
  return db
    .select({
      createdAt: member.createdAt,
      email: user.email,
      image: user.image,
      memberId: member.id,
      name: user.name,
      odcScopeMode: member.odcScopeMode,
      userId: user.id,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
        eq(organizationRole.isOdc, true),
      ),
    )
    .where(and(eq(member.organizationId, organizationId), eq(member.odcScopeMode, "all")));
}

export async function lockSelectedOdcMembers(
  tx: Transaction,
  organizationId: string,
  memberIds: string[],
) {
  if (!memberIds.length) {
    return;
  }
  const rows = await tx
    .select({ odcScopeMode: member.odcScopeMode })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.id, memberIds)))
    .orderBy(member.id)
    .for("update");
  if (rows.some((row) => row.odcScopeMode === "all")) {
    throw new HTTPException(409, {
      message: "该成员负责全部部门/中心，请前往成员与招聘组调整负责范围。",
    });
  }
}
