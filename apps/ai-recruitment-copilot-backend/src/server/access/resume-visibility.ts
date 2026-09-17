import type { SQL } from "drizzle-orm";
import { and, eq, exists, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { createRequestWorkspaceAuthorizer } from "./workspace-access-policy";
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
  resumeSourceOdcMember,
  jobDescription,
  member,
  organizationRole,
  studioInterview,
  studioInterviewOdcAssignment,
} from "@arc/db-schema/schema";

export interface ResumeVisibilityScope {
  actor?: { organizationId: string; userId: string };
  aiReviewOrganizationId?: string;
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

  const authorize = createRequestWorkspaceAuthorizer({
    memberRole: currentRole,
    organizationId,
    userId,
  });
  const [recruiting, odc, canApproveAiReview] = await Promise.all([
    resolveRecruitingVisibilityScope({ currentRole, organizationId, userId }),
    resolveOdcAccessScope({ actorUserId: userId, organizationId }),
    authorize({ action: "approve", resource: "aiReview" }),
  ]);
  return {
    actor: { organizationId, userId },
    ...(canApproveAiReview ? { aiReviewOrganizationId: organizationId } : {}),
    odc,
    odcActor:
      (odc.resumeSourceIds?.length ?? 0) > 0 ||
      odc.departmentIds.length > 0 ||
      odc.hiringUnitIds.length > 0
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
        resumeSourceOdcMember,
        and(
          eq(resumeSourceOdcMember.organizationId, member.organizationId),
          eq(resumeSourceOdcMember.memberId, member.id),
        ),
      )
      .leftJoin(
        jobDescription,
        and(
          eq(jobDescription.id, studioInterview.jobDescriptionId),
          eq(jobDescription.organizationId, studioInterview.organizationId),
        ),
      )
      .where(
        and(
          eq(jobDescription.resumeSourceId, resumeSourceOdcMember.resumeSourceId),
          eq(member.organizationId, actor.organizationId),
          eq(member.userId, actor.userId),
          eq(member.organizationId, studioInterview.organizationId),
          or(
            isNull(resumeSourceOdcMember.jobSeries),
            eq(resumeSourceOdcMember.jobSeries, jobDescription.jobSeries),
          ),
          or(
            isNull(resumeSourceOdcMember.serviceUnit),
            eq(resumeSourceOdcMember.serviceUnit, jobDescription.serviceUnit),
          ),
        ),
      ),
  );
}

// Apply after the union so recruiting groups/reporting lines cannot bypass the
// recipient restriction. Recheck the role, including ODCs without source bindings.
function buildOdcApprovalRestriction(actor?: {
  organizationId: string;
  userId: string;
}): SQL | undefined {
  if (!actor) {
    return;
  }
  const isOdc = exists(
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
      .where(and(eq(member.organizationId, actor.organizationId), eq(member.userId, actor.userId))),
  );
  return or(
    not(isOdc),
    eq(studioInterview.pipelineStage, "ai_review"),
    and(
      // 审核阶段之外，创建人/招聘组授权不能绕过 ODC 当前负责的来源。
      buildCurrentOdcVisibilityCondition(actor),
      or(
        ne(studioInterview.aiReviewApprovalStatus, "approved"),
        and(
          eq(studioInterview.organizationId, actor.organizationId),
          or(
            eq(studioInterview.aiReviewAssignedOdcUserId, actor.userId),
            exists(
              db
                .select({ value: sql`1` })
                .from(studioInterviewOdcAssignment)
                .where(
                  and(
                    eq(studioInterviewOdcAssignment.interviewRecordId, studioInterview.id),
                    eq(studioInterviewOdcAssignment.userId, actor.userId),
                  ),
                ),
            ),
          ),
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
  const actor = normalized.actor ?? normalized.odcActor;
  const approvalRestriction = buildOdcApprovalRestriction(actor);
  if (normalized.recruiting.kind === "all") {
    return approvalRestriction;
  }

  const recruitingCondition =
    normalized.recruiting.kind === "restricted" && normalized.recruiting.userIds.length > 0
      ? inArray(studioInterview.createdBy, normalized.recruiting.userIds)
      : undefined;
  // Approval grants visibility to the pending stage across reporting lines and
  // recruiting groups, without granting access to other stages or workspaces.
  const aiReviewCondition = normalized.aiReviewOrganizationId
    ? and(
        eq(studioInterview.organizationId, normalized.aiReviewOrganizationId),
        eq(studioInterview.pipelineStage, "ai_review"),
      )
    : undefined;
  const odcJobCondition = buildJobDescriptionHiringUnitScopeCondition({
    canAccessAll: false,
    canAccessPublic: false,
    departmentIds: normalized.odc.departmentIds,
    hiringUnitIds: normalized.odc.hiringUnitIds,
    resumeSourceIds: normalized.odc.resumeSourceIds,
  });
  const assignedOdcCondition =
    (normalized.odc.resumeSourceIds?.length ?? 0) > 0 ||
    normalized.odc.departmentIds.length > 0 ||
    normalized.odc.hiringUnitIds.length > 0
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
    : assignedOdcCondition;

  if (
    !aiReviewCondition &&
    !recruitingCondition &&
    (normalized.odc.resumeSourceIds?.length ?? 0) === 0 &&
    normalized.odc.departmentIds.length === 0 &&
    normalized.odc.hiringUnitIds.length === 0
  ) {
    return sql`false`;
  }
  return and(or(recruitingCondition, odcCondition, aiReviewCondition), approvalRestriction);
}
