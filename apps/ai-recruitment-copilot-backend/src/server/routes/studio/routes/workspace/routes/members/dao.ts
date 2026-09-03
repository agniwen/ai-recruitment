import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, memberReportingLine } from "@arc/db-schema/schema";

export interface WorkspaceMemberHierarchyRow {
  directManagerUserId: string | null;
  userId: string;
}

export async function listWorkspaceMemberHierarchy(
  organizationId: string,
): Promise<WorkspaceMemberHierarchyRow[]> {
  const [members, reportingLines] = await Promise.all([
    db
      .select({ id: member.id, userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
    db
      .select({
        directManagerId: memberReportingLine.directManagerId,
        memberId: memberReportingLine.memberId,
      })
      .from(memberReportingLine)
      .where(eq(memberReportingLine.organizationId, organizationId)),
  ]);
  const userIdByMemberId = new Map(members.map((row) => [row.id, row.userId]));
  const directManagerIdByMemberId = new Map(
    reportingLines.map((row) => [row.memberId, row.directManagerId]),
  );

  return members.map((workspaceMember) => ({
    directManagerUserId:
      userIdByMemberId.get(directManagerIdByMemberId.get(workspaceMember.id) ?? "") ?? null,
    userId: workspaceMember.userId,
  }));
}

export function updateWorkspaceMemberDirectManager({
  directManagerUserId,
  organizationId,
  userId,
}: {
  directManagerUserId: string | null;
  organizationId: string;
  userId: string;
}): Promise<"cycle" | "missing" | "self" | "updated"> {
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: member.id, userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .for("update");
    const memberByUserId = new Map(members.map((row) => [row.userId, row]));
    const targetMember = memberByUserId.get(userId);
    if (!targetMember) {
      return "missing";
    }
    if (directManagerUserId === userId) {
      return "self";
    }

    if (!directManagerUserId) {
      await tx
        .delete(memberReportingLine)
        .where(
          and(
            eq(memberReportingLine.organizationId, organizationId),
            eq(memberReportingLine.memberId, targetMember.id),
          ),
        );
      return "updated";
    }

    const directManager = memberByUserId.get(directManagerUserId);
    if (!directManager) {
      return "missing";
    }

    const reportingLines = await tx
      .select({
        directManagerId: memberReportingLine.directManagerId,
        memberId: memberReportingLine.memberId,
      })
      .from(memberReportingLine)
      .where(eq(memberReportingLine.organizationId, organizationId));
    const managerByMemberId = new Map(
      reportingLines.map((row) => [row.memberId, row.directManagerId]),
    );
    const visited = new Set<string>();
    let ancestorId: string | undefined = directManager.id;
    while (ancestorId) {
      if (ancestorId === targetMember.id) {
        return "cycle";
      }
      if (visited.has(ancestorId)) {
        return "cycle";
      }
      visited.add(ancestorId);
      ancestorId = managerByMemberId.get(ancestorId);
    }

    await tx
      .insert(memberReportingLine)
      .values({
        directManagerId: directManager.id,
        memberId: targetMember.id,
        organizationId,
      })
      .onConflictDoUpdate({
        set: { directManagerId: directManager.id },
        target: [memberReportingLine.organizationId, memberReportingLine.memberId],
      });
    return "updated";
  });
}

export function updateWorkspaceMembersDirectManager({
  directManagerUserId,
  organizationId,
  userIds,
}: {
  directManagerUserId: string;
  organizationId: string;
  userIds: string[];
}): Promise<"cycle" | "missing" | "self" | "updated"> {
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: member.id, userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .for("update");
    const memberByUserId = new Map(members.map((row) => [row.userId, row]));
    const selectedUserIds = new Set(userIds);
    const directManager = memberByUserId.get(directManagerUserId);
    const targetMemberIds = [...selectedUserIds]
      .map((userId) => memberByUserId.get(userId)?.id)
      .filter((memberId): memberId is string => memberId !== undefined);
    if (!(directManager && targetMemberIds.length === selectedUserIds.size)) {
      return "missing";
    }
    if (selectedUserIds.has(directManagerUserId)) {
      return "self";
    }

    const reportingLines = await tx
      .select({
        directManagerId: memberReportingLine.directManagerId,
        memberId: memberReportingLine.memberId,
      })
      .from(memberReportingLine)
      .where(eq(memberReportingLine.organizationId, organizationId));
    const managerByMemberId = new Map(
      reportingLines.map((row) => [row.memberId, row.directManagerId]),
    );
    for (const targetMemberId of targetMemberIds) {
      managerByMemberId.set(targetMemberId, directManager.id);
    }
    for (const targetMemberId of targetMemberIds) {
      const visited = new Set<string>();
      let ancestorId: string | undefined = targetMemberId;
      while (ancestorId) {
        if (visited.has(ancestorId)) {
          return "cycle";
        }
        visited.add(ancestorId);
        ancestorId = managerByMemberId.get(ancestorId);
      }
    }

    await tx
      .insert(memberReportingLine)
      .values(
        targetMemberIds.map((memberId) => ({
          directManagerId: directManager.id,
          memberId,
          organizationId,
        })),
      )
      .onConflictDoUpdate({
        set: { directManagerId: directManager.id },
        target: [memberReportingLine.organizationId, memberReportingLine.memberId],
      });
    return "updated";
  });
}
