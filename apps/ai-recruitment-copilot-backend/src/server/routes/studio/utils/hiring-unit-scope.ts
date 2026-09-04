import type { SQL } from "drizzle-orm";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  departmentOdcMember,
  hiringUnitOdcMember,
  jobDescription,
  member,
  organizationRole,
  recruitingGroupHiringUnit,
  recruitingGroupMember,
} from "@arc/db-schema/schema";

export interface HiringUnitAccessScope {
  canAccessAll: boolean;
  canAccessPublic: boolean;
  departmentIds: string[];
  hiringUnitIds: string[];
}

export interface OdcAccessScope {
  departmentIds: string[];
  hiringUnitIds: string[];
}

export const EMPTY_ODC_ACCESS_SCOPE: OdcAccessScope = {
  departmentIds: [],
  hiringUnitIds: [],
};

export const ALL_HIRING_UNIT_SCOPE: HiringUnitAccessScope = {
  canAccessAll: true,
  canAccessPublic: true,
  departmentIds: [],
  hiringUnitIds: [],
};

export const EMPTY_HIRING_UNIT_SCOPE: HiringUnitAccessScope = {
  canAccessAll: false,
  canAccessPublic: false,
  departmentIds: [],
  hiringUnitIds: [],
};

export async function resolveOdcAccessScope({
  actorUserId,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  organizationId: string;
}): Promise<OdcAccessScope> {
  if (!actorUserId) {
    return EMPTY_ODC_ACCESS_SCOPE;
  }

  const [workspaceMember] = await db
    .select({ id: member.id, isOdc: organizationRole.isOdc })
    .from(member)
    .leftJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
      ),
    )
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, actorUserId)))
    .limit(1);
  if (!workspaceMember?.isOdc) {
    return EMPTY_ODC_ACCESS_SCOPE;
  }

  const [hiringUnitRows, departmentRows] = await Promise.all([
    db
      .select({ id: hiringUnitOdcMember.hiringUnitId })
      .from(hiringUnitOdcMember)
      .where(
        and(
          eq(hiringUnitOdcMember.organizationId, organizationId),
          eq(hiringUnitOdcMember.memberId, workspaceMember.id),
        ),
      ),
    db
      .select({ id: departmentOdcMember.departmentId })
      .from(departmentOdcMember)
      .where(
        and(
          eq(departmentOdcMember.organizationId, organizationId),
          eq(departmentOdcMember.memberId, workspaceMember.id),
        ),
      ),
  ]);

  return {
    departmentIds: [...new Set(departmentRows.map((row) => row.id))],
    hiringUnitIds: [...new Set(hiringUnitRows.map((row) => row.id))],
  };
}

export async function resolveHiringUnitAccessScope({
  actorUserId,
  includeOdc = true,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  includeOdc?: boolean;
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

  const [rows, odcScope] = await Promise.all([
    db
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
      ),
    includeOdc
      ? resolveOdcAccessScope({ actorUserId, organizationId })
      : Promise.resolve(EMPTY_ODC_ACCESS_SCOPE),
  ]);

  if (
    rows.length === 0 &&
    odcScope.hiringUnitIds.length === 0 &&
    odcScope.departmentIds.length === 0
  ) {
    return EMPTY_HIRING_UNIT_SCOPE;
  }

  return {
    canAccessAll: false,
    canAccessPublic: rows.length > 0,
    departmentIds: odcScope.departmentIds,
    hiringUnitIds: [
      ...new Set([
        ...rows.map((row) => row.hiringUnitId).filter((id): id is string => id !== null),
        ...odcScope.hiringUnitIds,
      ]),
    ],
  };
}

export function buildDepartmentHiringUnitScopeCondition(
  scope: HiringUnitAccessScope,
): SQL | undefined {
  if (scope.canAccessAll) {
    return;
  }
  if (
    !scope.canAccessPublic &&
    scope.hiringUnitIds.length === 0 &&
    scope.departmentIds.length === 0
  ) {
    return sql`false`;
  }
  return or(
    scope.departmentIds.length > 0 ? inArray(department.id, scope.departmentIds) : undefined,
    scope.hiringUnitIds.length > 0
      ? inArray(department.hiringUnitId, scope.hiringUnitIds)
      : undefined,
    scope.canAccessPublic ? isNull(department.hiringUnitId) : undefined,
  );
}

/**
 * Job-description visibility:
 * - A hiring-unit assignment includes every job in its child departments.
 * - A direct department assignment includes only that department's jobs.
 * - Public access preserves the legacy source-aware null-unit behavior.
 */
export function buildJobDescriptionHiringUnitScopeCondition(
  scope: HiringUnitAccessScope,
): SQL | undefined {
  if (scope.canAccessAll) {
    return;
  }
  if (
    !scope.canAccessPublic &&
    scope.hiringUnitIds.length === 0 &&
    scope.departmentIds.length === 0
  ) {
    return sql`false`;
  }

  const jobUnitInScope =
    scope.hiringUnitIds.length > 0
      ? inArray(jobDescription.hiringUnitId, scope.hiringUnitIds)
      : undefined;
  const departmentUnitInScope =
    scope.hiringUnitIds.length > 0
      ? inArray(department.hiringUnitId, scope.hiringUnitIds)
      : undefined;
  const departmentInScope =
    scope.departmentIds.length > 0
      ? inArray(jobDescription.departmentId, scope.departmentIds)
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

  return or(jobUnitInScope, departmentUnitInScope, departmentInScope, publicAccess);
}

export async function resolveDepartmentHiringUnitScopeCondition({
  actorUserId,
  includeOdc,
  organizationId,
}: {
  actorUserId?: string | null;
  includeOdc?: boolean;
  organizationId: string;
}): Promise<SQL | undefined> {
  if (!actorUserId) {
    return;
  }
  return buildDepartmentHiringUnitScopeCondition(
    await resolveHiringUnitAccessScope({ actorUserId, includeOdc, organizationId }),
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
