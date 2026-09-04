import type { SQL } from "drizzle-orm";
import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { resolveRecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import {
  buildJobDescriptionHiringUnitScopeCondition,
  EMPTY_ODC_ACCESS_SCOPE,
  resolveOdcAccessScope,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import type { OdcAccessScope } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import {
  department,
  departmentOdcMember,
  hiringUnitOdcMember,
  jobDescription,
  member,
  organizationRole,
  studioInterview,
} from "@arc/db-schema/schema";

export interface ResumeVisibilityScope {
  odc: OdcAccessScope;
  odcActor?: { organizationId: string; userId: string };
  recruiting: RecruitingVisibilityScope;
}

export type CompatibleResumeVisibilityScope = ResumeVisibilityScope | RecruitingVisibilityScope;

export async function resolveResumeVisibilityScope({
  currentRole,
  organizationId,
  userId,
}: {
  currentRole?: string | null;
  organizationId: string;
  userId: string;
}): Promise<ResumeVisibilityScope> {
  if (currentRole === "owner" || currentRole === "admin") {
    return { odc: EMPTY_ODC_ACCESS_SCOPE, recruiting: { kind: "all" } };
  }

  const [recruiting, odc] = await Promise.all([
    resolveRecruitingVisibilityScope({ currentRole, organizationId, userId }),
    resolveOdcAccessScope({ actorUserId: userId, organizationId }),
  ]);
  return {
    odc,
    odcActor:
      odc.departmentIds.length > 0 || odc.hiringUnitIds.length > 0
        ? { organizationId, userId }
        : undefined,
    recruiting,
  };
}

function normalizeScope(scope: CompatibleResumeVisibilityScope): ResumeVisibilityScope {
  return "recruiting" in scope ? scope : { odc: EMPTY_ODC_ACCESS_SCOPE, recruiting: scope };
}

export function getRecruitingVisibilityScope(
  scope: CompatibleResumeVisibilityScope,
): RecruitingVisibilityScope {
  return normalizeScope(scope).recruiting;
}

function buildCurrentOdcVisibilityCondition(actor: {
  organizationId: string;
  userId: string;
}): SQL {
  return exists(
    db
      .select({ value: sql`1` })
      .from(member)
      .innerJoin(
        organizationRole,
        and(
          eq(organizationRole.organizationId, member.organizationId),
          eq(organizationRole.role, member.role),
          eq(organizationRole.isOdc, true),
        ),
      )
      .leftJoin(
        hiringUnitOdcMember,
        and(
          eq(hiringUnitOdcMember.organizationId, member.organizationId),
          eq(hiringUnitOdcMember.memberId, member.id),
        ),
      )
      .leftJoin(
        departmentOdcMember,
        and(
          eq(departmentOdcMember.organizationId, member.organizationId),
          eq(departmentOdcMember.memberId, member.id),
        ),
      )
      .leftJoin(
        jobDescription,
        and(
          eq(jobDescription.id, studioInterview.jobDescriptionId),
          eq(jobDescription.organizationId, studioInterview.organizationId),
        ),
      )
      .leftJoin(
        department,
        and(
          eq(department.id, jobDescription.departmentId),
          eq(department.organizationId, jobDescription.organizationId),
        ),
      )
      .where(
        and(
          eq(member.organizationId, actor.organizationId),
          eq(member.userId, actor.userId),
          eq(member.organizationId, studioInterview.organizationId),
          or(
            eq(hiringUnitOdcMember.hiringUnitId, studioInterview.hiringUnitId),
            eq(hiringUnitOdcMember.hiringUnitId, jobDescription.hiringUnitId),
            eq(hiringUnitOdcMember.hiringUnitId, department.hiringUnitId),
            eq(departmentOdcMember.departmentId, jobDescription.departmentId),
          ),
        ),
      ),
  );
}

export function buildResumeVisibilityCondition(
  scope: CompatibleResumeVisibilityScope | undefined,
): SQL | undefined {
  if (!scope) {
    return;
  }
  const normalized = normalizeScope(scope);
  if (normalized.recruiting.kind === "all") {
    return;
  }

  const recruitingCondition =
    normalized.recruiting.kind === "restricted" && normalized.recruiting.userIds.length > 0
      ? inArray(studioInterview.createdBy, normalized.recruiting.userIds)
      : undefined;
  const directHiringUnitCondition =
    normalized.odc.hiringUnitIds.length > 0
      ? inArray(studioInterview.hiringUnitId, normalized.odc.hiringUnitIds)
      : undefined;
  const odcJobCondition = buildJobDescriptionHiringUnitScopeCondition({
    canAccessAll: false,
    canAccessPublic: false,
    departmentIds: normalized.odc.departmentIds,
    hiringUnitIds: normalized.odc.hiringUnitIds,
  });
  const assignedOdcCondition =
    normalized.odc.departmentIds.length > 0 || normalized.odc.hiringUnitIds.length > 0
      ? exists(
          db
            .select({ value: sql`1` })
            .from(jobDescription)
            .leftJoin(
              department,
              and(
                eq(jobDescription.departmentId, department.id),
                eq(department.organizationId, jobDescription.organizationId),
              ),
            )
            .where(
              and(
                eq(jobDescription.id, studioInterview.jobDescriptionId),
                eq(jobDescription.organizationId, studioInterview.organizationId),
                odcJobCondition,
              ),
            ),
        )
      : undefined;
  const odcCondition = normalized.odcActor
    ? buildCurrentOdcVisibilityCondition(normalized.odcActor)
    : or(directHiringUnitCondition, assignedOdcCondition);

  if (
    !recruitingCondition &&
    normalized.odc.departmentIds.length === 0 &&
    normalized.odc.hiringUnitIds.length === 0
  ) {
    return sql`false`;
  }
  return or(recruitingCondition, odcCondition);
}
