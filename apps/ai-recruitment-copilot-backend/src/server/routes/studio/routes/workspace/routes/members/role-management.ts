import { and, eq, ne } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, organization, organizationRole } from "@arc/db-schema/schema";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";

export function memberManagementError({
  actorRole,
  targetRole,
  nextRole,
  ownerCount,
}: {
  actorRole: string | undefined;
  targetRole: string | undefined;
  nextRole: string | null;
  ownerCount: number;
}): string | null {
  if (!isWorkspaceAdministratorRole(actorRole)) {
    return "只有管理员可以管理工作区成员。";
  }
  if (!targetRole) {
    return "成员不存在。";
  }
  if (targetRole === "owner" && nextRole !== "owner" && ownerCount <= 1) {
    return "请先转移工作区所有权，再调整或移除最后一位拥有者。";
  }
  return null;
}

// Serialize ownership changes per workspace so concurrent requests cannot remove all owners.
export async function manageWorkspaceMember(input: {
  organizationId: string;
  actorId: string;
  memberId: string;
  role: string | null;
}) {
  return await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    const members = await tx
      .select()
      .from(member)
      .where(eq(member.organizationId, input.organizationId))
      .for("update");
    const actor = members.find((row) => row.userId === input.actorId);
    const target = members.find((row) => row.id === input.memberId);
    const error = memberManagementError({
      actorRole: actor?.role,
      nextRole: input.role,
      ownerCount: members.filter((row) => row.role === "owner").length,
      targetRole: target?.role,
    });
    if (error || !target) {
      return { error: error ?? "成员不存在。" };
    }
    if (input.role === null) {
      await tx
        .delete(member)
        .where(and(eq(member.id, target.id), eq(member.organizationId, input.organizationId)));
      return { error: null };
    }
    if (!["owner", "admin", "member", "noAccess"].includes(input.role)) {
      const [role] = await tx
        .select({ id: organizationRole.id })
        .from(organizationRole)
        .where(
          and(
            eq(organizationRole.organizationId, input.organizationId),
            eq(organizationRole.role, input.role),
          ),
        )
        .limit(1);
      if (!role) {
        return { error: "工作区角色不存在。" };
      }
    }
    if (input.role === "owner") {
      await tx
        .update(member)
        .set({ role: "admin" })
        .where(
          and(
            eq(member.organizationId, input.organizationId),
            eq(member.role, "owner"),
            ne(member.id, target.id),
          ),
        );
    }
    await tx
      .update(member)
      .set({ role: input.role })
      .where(and(eq(member.id, target.id), eq(member.organizationId, input.organizationId)));
    return { error: null };
  });
}
