import type { SQL } from "drizzle-orm";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  jobDescription,
  member,
  recruitingGroupHiringUnit,
  recruitingGroupMember,
} from "@arc/db-schema/schema";

export interface HiringUnitAccessScope {
  canAccessAll: boolean;
  canAccessPublic: boolean;
  hiringUnitIds: string[];
}

export const ALL_HIRING_UNIT_SCOPE: HiringUnitAccessScope = {
  canAccessAll: true,
  canAccessPublic: true,
  hiringUnitIds: [],
};

export const EMPTY_HIRING_UNIT_SCOPE: HiringUnitAccessScope = {
  canAccessAll: false,
  canAccessPublic: false,
  hiringUnitIds: [],
};

export async function resolveHiringUnitAccessScope({
  actorUserId,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  organizationId: string;
}): Promise<HiringUnitAccessScope> {
  if (!actorUserId) {
    return ALL_HIRING_UNIT_SCOPE;
  }

  const [workspaceMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, actorUserId)))
    .limit(1);
  if (!workspaceMember) {
    return EMPTY_HIRING_UNIT_SCOPE;
  }
  if (workspaceMember.role === "owner" || workspaceMember.role === "admin") {
    return ALL_HIRING_UNIT_SCOPE;
  }

  const rows = await db
    .select({
      groupId: recruitingGroupMember.groupId,
      hiringUnitId: recruitingGroupHiringUnit.hiringUnitId,
    })
    .from(recruitingGroupMember)
    .leftJoin(
      recruitingGroupHiringUnit,
      and(
        eq(recruitingGroupHiringUnit.organizationId, recruitingGroupMember.organizationId),
        eq(recruitingGroupHiringUnit.groupId, recruitingGroupMember.groupId),
      ),
    )
    .where(
      and(
        eq(recruitingGroupMember.organizationId, organizationId),
        eq(recruitingGroupMember.userId, actorUserId),
      ),
    );

  if (rows.length === 0) {
    return EMPTY_HIRING_UNIT_SCOPE;
  }

  return {
    canAccessAll: false,
    canAccessPublic: true,
    hiringUnitIds: [
      ...new Set(rows.map((row) => row.hiringUnitId).filter((id): id is string => id !== null)),
    ],
  };
}

export function buildDepartmentHiringUnitScopeCondition(
  scope: HiringUnitAccessScope,
): SQL | undefined {
  if (scope.canAccessAll) {
    return;
  }
  if (!scope.canAccessPublic && scope.hiringUnitIds.length === 0) {
    return sql`false`;
  }
  if (scope.hiringUnitIds.length === 0) {
    return scope.canAccessPublic ? isNull(department.hiringUnitId) : sql`false`;
  }
  if (!scope.canAccessPublic) {
    return inArray(department.hiringUnitId, scope.hiringUnitIds);
  }
  return or(isNull(department.hiringUnitId), inArray(department.hiringUnitId, scope.hiringUnitIds));
}

/**
 * Job-description visibility:
 * - Google-synced jobs use the explicit job-level hiring unit, including null.
 * - Manual jobs fall back to the linked department's hiring unit.
 */
export function buildJobDescriptionHiringUnitScopeCondition(
  scope: HiringUnitAccessScope,
): SQL | undefined {
  if (scope.canAccessAll) {
    return;
  }
  if (!scope.canAccessPublic && scope.hiringUnitIds.length === 0) {
    return sql`false`;
  }

  const jobUnitInScope =
    scope.hiringUnitIds.length > 0
      ? inArray(jobDescription.hiringUnitId, scope.hiringUnitIds)
      : undefined;
  const departmentUnitInScope =
    scope.hiringUnitIds.length > 0
      ? and(
          eq(jobDescription.creationSource, "manual"),
          isNull(jobDescription.hiringUnitId),
          inArray(department.hiringUnitId, scope.hiringUnitIds),
        )
      : undefined;
  const publicAccess = scope.canAccessPublic
    ? and(
        isNull(jobDescription.hiringUnitId),
        or(
          eq(jobDescription.creationSource, "google_sheets"),
          and(eq(jobDescription.creationSource, "manual"), isNull(department.hiringUnitId)),
        ),
      )
    : undefined;

  return or(jobUnitInScope, departmentUnitInScope, publicAccess);
}

export async function resolveDepartmentHiringUnitScopeCondition({
  actorUserId,
  organizationId,
}: {
  actorUserId?: string | null;
  organizationId: string;
}): Promise<SQL | undefined> {
  if (!actorUserId) {
    return;
  }
  return buildDepartmentHiringUnitScopeCondition(
    await resolveHiringUnitAccessScope({ actorUserId, organizationId }),
  );
}

export async function resolveJobDescriptionHiringUnitScopeCondition({
  actorUserId,
  organizationId,
}: {
  actorUserId?: string | null;
  organizationId: string;
}): Promise<SQL | undefined> {
  if (!actorUserId) {
    return;
  }
  return buildJobDescriptionHiringUnitScopeCondition(
    await resolveHiringUnitAccessScope({ actorUserId, organizationId }),
  );
}
