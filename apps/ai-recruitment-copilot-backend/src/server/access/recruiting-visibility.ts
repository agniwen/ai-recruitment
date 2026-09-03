import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, recruitingGroupMember } from "@arc/db-schema/schema";

export type RecruitingVisibilityScope =
  | { kind: "all" }
  | { kind: "restricted"; userIds: string[] }
  | { kind: "none" };

const ALL_DATA_ROLES = new Set(["owner", "admin"]);

const GROUP_ROLE_RANK: Record<string, number> = {
  hr: 1,
  recruitingLead: 2,
  recruitingSupervisor: 3,
  viewer: 0,
};

interface OrganizationMemberVisibilityRow {
  directManagerId: string | null;
  id: string;
  role: string;
  userId: string;
}

function collectInheritedMembers(
  currentMember: OrganizationMemberVisibilityRow,
  organizationMembers: OrganizationMemberVisibilityRow[],
): OrganizationMemberVisibilityRow[] {
  const membersByManagerId = new Map<string, OrganizationMemberVisibilityRow[]>();
  for (const workspaceMember of organizationMembers) {
    if (!workspaceMember.directManagerId) {
      continue;
    }
    const reports = membersByManagerId.get(workspaceMember.directManagerId) ?? [];
    reports.push(workspaceMember);
    membersByManagerId.set(workspaceMember.directManagerId, reports);
  }

  const inheritedMembers = [currentMember];
  const inheritedMemberIds = new Set([currentMember.id]);
  for (const manager of inheritedMembers) {
    for (const report of membersByManagerId.get(manager.id) ?? []) {
      if (!inheritedMemberIds.has(report.id)) {
        inheritedMemberIds.add(report.id);
        inheritedMembers.push(report);
      }
    }
  }
  return inheritedMembers;
}

function buildRanksByGroup(
  memberships: { groupId: string; role: string }[],
): Map<string, number[]> {
  const ranksByGroup = new Map<string, number[]>();
  for (const membership of memberships) {
    const ranks = ranksByGroup.get(membership.groupId) ?? [];
    ranks.push(GROUP_ROLE_RANK[membership.role] ?? 0);
    ranksByGroup.set(membership.groupId, ranks);
  }
  return ranksByGroup;
}

export async function resolveRecruitingVisibilityScope({
  currentRole,
  organizationId,
  userId,
}: {
  currentRole?: string | null;
  organizationId: string;
  userId: string;
}): Promise<RecruitingVisibilityScope> {
  if (currentRole && ALL_DATA_ROLES.has(currentRole)) {
    return { kind: "all" };
  }

  const organizationMembers = await db
    .select({
      directManagerId: member.directManagerId,
      id: member.id,
      role: member.role,
      userId: member.userId,
    })
    .from(member)
    .where(eq(member.organizationId, organizationId));
  const currentMember = organizationMembers.find((row) => row.userId === userId);

  if (!currentMember) {
    return { kind: "none" };
  }

  if (ALL_DATA_ROLES.has(currentMember.role)) {
    return { kind: "all" };
  }

  const inheritedMembers = collectInheritedMembers(currentMember, organizationMembers);
  if (inheritedMembers.some((workspaceMember) => ALL_DATA_ROLES.has(workspaceMember.role))) {
    return { kind: "all" };
  }

  const inheritedUserIds = inheritedMembers.map((workspaceMember) => workspaceMember.userId);
  const inheritedMemberships = await db
    .select({
      groupId: recruitingGroupMember.groupId,
      role: recruitingGroupMember.role,
      userId: recruitingGroupMember.userId,
    })
    .from(recruitingGroupMember)
    .where(
      and(
        eq(recruitingGroupMember.organizationId, organizationId),
        inArray(recruitingGroupMember.userId, inheritedUserIds),
      ),
    );

  if (inheritedMemberships.length === 0) {
    return { kind: "restricted", userIds: inheritedUserIds };
  }

  const ownRanksByGroup = buildRanksByGroup(inheritedMemberships);
  const groupRows = await db
    .select({
      groupId: recruitingGroupMember.groupId,
      role: recruitingGroupMember.role,
      userId: recruitingGroupMember.userId,
    })
    .from(recruitingGroupMember)
    .where(
      and(
        eq(recruitingGroupMember.organizationId, organizationId),
        inArray(recruitingGroupMember.groupId, [...ownRanksByGroup.keys()]),
      ),
    );

  const visible = new Set<string>(inheritedUserIds);
  for (const row of groupRows) {
    const targetRank = GROUP_ROLE_RANK[row.role] ?? 0;
    const canSeeTarget = (ownRanksByGroup.get(row.groupId) ?? []).some(
      (ownRank) => ownRank >= GROUP_ROLE_RANK.recruitingLead && targetRank < ownRank,
    );
    if (canSeeTarget) {
      visible.add(row.userId);
    }
  }

  return {
    kind: "restricted",
    userIds: [...visible],
  };
}

export function intersectRequestedCreatorIds(
  requestedCreatorIds: string[] | null | undefined,
  scope: RecruitingVisibilityScope,
): string[] | null {
  const requested = requestedCreatorIds?.filter((id) => id.trim().length > 0);

  if (scope.kind === "all") {
    return requested && requested.length > 0 ? requested : null;
  }

  if (scope.kind === "none") {
    return [];
  }

  if (!requested || requested.length === 0) {
    return scope.userIds;
  }

  const visible = new Set(scope.userIds);
  return requested.filter((id) => visible.has(id));
}
