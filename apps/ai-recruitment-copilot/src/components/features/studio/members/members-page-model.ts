import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/client/auth-client";
import { isBuiltInWorkspaceRole } from "@/components/features/studio/members/role-display";
import type { WorkspaceRole } from "@/components/features/studio/members/role-display";
import { sortDynamicWorkspaceRolesByCreatedAt } from "@/components/features/studio/members/workspace-role-permissions";

export const DEFAULT_TAB = "members";
const WORKSPACE_MANAGEMENT_TABS = ["members", "groups"] as const;

export type WorkspaceManagementTab = (typeof WORKSPACE_MANAGEMENT_TABS)[number];

export interface WorkspaceManagementSearch {
  tab?: WorkspaceManagementTab;
}

export function parseWorkspaceManagementTab(value: unknown): WorkspaceManagementTab {
  return value === "groups" ? "groups" : DEFAULT_TAB;
}

export function coerceWorkspaceManagementSearch(
  search: Record<string, unknown>,
): WorkspaceManagementSearch {
  const tab = parseWorkspaceManagementTab(search.tab);
  return tab === DEFAULT_TAB ? {} : { tab };
}

export function buildWorkspaceManagementSearch(
  previous: WorkspaceManagementSearch,
  tab: WorkspaceManagementTab,
): WorkspaceManagementSearch {
  if (tab === DEFAULT_TAB) {
    const { tab: _tab, ...rest } = previous;
    return rest;
  }
  return { ...previous, tab };
}

export interface MemberRow {
  id: string;
  userId: string;
  email: string;
  name: string;
  image: string | null;
  isInterviewer: boolean;
  role: string;
  telegram: string | null;
  createdAt: string | Date;
  lastActiveAt: string | null;
  treeDepth?: number;
  hasDirectReports?: boolean;
}

export function filterWorkspaceMembers(rows: readonly MemberRow[], search: string): MemberRow[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return [...rows];
  }
  return rows.filter((row) =>
    [row.email, row.name, row.telegram ?? ""].some((value) =>
      value.toLowerCase().includes(normalizedSearch),
    ),
  );
}

export function buildWorkspaceMemberTreeRows(
  rows: readonly MemberRow[],
  directManagerByUserId: ReadonlyMap<string, string | null>,
  collapsedUserIds: ReadonlySet<string>,
): MemberRow[] {
  const memberByUserId = new Map(rows.map((row) => [row.userId, row]));
  const childrenByManagerUserId = new Map<string, MemberRow[]>();
  const roots: MemberRow[] = [];

  for (const row of rows) {
    const directManagerUserId = directManagerByUserId.get(row.userId);
    if (
      !directManagerUserId ||
      directManagerUserId === row.userId ||
      !memberByUserId.has(directManagerUserId)
    ) {
      roots.push(row);
      continue;
    }
    const children = childrenByManagerUserId.get(directManagerUserId) ?? [];
    children.push(row);
    childrenByManagerUserId.set(directManagerUserId, children);
  }

  const result: MemberRow[] = [];
  const visited = new Set<string>();
  function appendMember(row: MemberRow, treeDepth: number) {
    if (visited.has(row.userId)) {
      return;
    }
    visited.add(row.userId);
    const children = childrenByManagerUserId.get(row.userId) ?? [];
    result.push({ ...row, hasDirectReports: children.length > 0, treeDepth });
    if (collapsedUserIds.has(row.userId)) {
      return;
    }
    for (const child of children) {
      appendMember(child, treeDepth + 1);
    }
  }

  for (const root of roots) {
    appendMember(root, 0);
  }
  // A persisted cycle should be impossible, but keeping remaining rows visible makes the UI
  // resilient to legacy or manually edited data.
  for (const row of rows) {
    appendMember(row, 0);
  }
  return result;
}

export interface DynamicWorkspaceRole {
  createdAt: Date | string;
  id: string;
  name: string;
  role: string;
}

export type RecruitingGroupRole = "recruitingSupervisor" | "recruitingLead" | "hr" | "viewer";

export interface RecruitingGroupMemberRow {
  id: string;
  userId: string;
  email: string;
  name: string;
  image: string | null;
  role: RecruitingGroupRole | null;
}

export interface RecruitingGroupRow {
  id: string;
  name: string;
  createdAt: string;
  hiringUnitIds: string[];
  hiringUnits: { id: string; name: string }[];
  isDefault: boolean;
  isVirtual?: boolean;
  members: RecruitingGroupMemberRow[];
  memberUserIds: string[];
}

export const EMPTY_RECRUITING_GROUPS: RecruitingGroupRow[] = [];
const WORKSPACE_ROLE_BADGE_VARIANT: Record<WorkspaceRole, "default" | "secondary" | "outline"> = {
  admin: "secondary",
  member: "outline",
  noAccess: "outline",
  owner: "default",
};

export function getWorkspaceRoleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (!isBuiltInWorkspaceRole(role)) {
    return "outline";
  }
  return WORKSPACE_ROLE_BADGE_VARIANT[role];
}

export function buildAssignableWorkspaceRoles(
  currentRole: string,
  dynamicRoles: readonly DynamicWorkspaceRole[],
): readonly string[] {
  let builtInRoles: string[] = [];
  if (currentRole === "owner") {
    builtInRoles = ["admin", "member", "noAccess"];
  } else if (currentRole === "admin") {
    builtInRoles = ["member", "noAccess"];
  }
  return [...builtInRoles, ...dynamicRoles.map((role) => role.role)].filter(
    (role, index, list) => list.indexOf(role) === index,
  );
}

export function canEditMemberWorkspaceRole({
  assignableRoles,
  canUpdate,
  currentRole,
  currentUserId,
  row,
}: {
  assignableRoles: readonly string[];
  canUpdate: boolean;
  currentRole: string;
  currentUserId: string | undefined;
  row: MemberRow;
}): boolean {
  if (!(canUpdate && assignableRoles.length > 0)) {
    return false;
  }
  if (currentRole === "owner") {
    return row.role !== "owner";
  }
  return (
    currentRole === "admin" &&
    row.role !== "owner" &&
    row.role !== "admin" &&
    row.userId !== currentUserId
  );
}

export function useDynamicWorkspaceRoles(workspaceId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: async () => {
      const { data, error } = await authClient.organization.listRoles({
        query: { organizationId: workspaceId },
      });
      if (error) {
        throw new Error(error.message ?? "加载自定义角色失败");
      }
      return (data ?? []) as DynamicWorkspaceRole[];
    },
    queryKey: ["workspace-dynamic-roles", workspaceId],
    refetchOnWindowFocus: false,
    select: sortDynamicWorkspaceRolesByCreatedAt,
  });
}

export const GROUP_ROLE_LABELS: Record<RecruitingGroupRole, string> = {
  hr: "招聘成员",
  recruitingLead: "招聘组长",
  recruitingSupervisor: "招聘主管",
  viewer: "只读成员",
};

export const GROUP_ROLE_BADGE_VARIANT: Record<
  RecruitingGroupRole,
  "default" | "secondary" | "outline"
> = {
  hr: "secondary",
  recruitingLead: "secondary",
  recruitingSupervisor: "default",
  viewer: "outline",
};
