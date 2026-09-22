import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  member,
  organizationRole,
  resumeSourceOdcMember,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import { resolveTelegramRecipientId } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import {
  hasPermissionInStatements,
  normalizePermissionStatements,
} from "@arc/shared/permission-statements";

type Executor = Pick<typeof db, "select">;

function hasCandidateManagementPermission(permission: string): boolean {
  try {
    return hasPermissionInStatements(
      normalizePermissionStatements(JSON.parse(permission) as unknown),
      "page",
      "resumes",
    );
  } catch {
    return false;
  }
}

// Match the same source, role, job-series and service-unit boundaries used by
// resume visibility, and require candidate-management page access on the ODC role.
export async function listAiReviewNotificationRecipients(
  input: { candidateId: string; organizationId: string },
  executor: Executor = db,
) {
  const rows = await executor
    .select({
      departmentNames: sql<string[]>`array(
        select distinct coalesce(d.name, '全部部门')
        from odc_department_responsibility scope
        left join department d on d.id = scope.department_id and d.organization_id = scope.organization_id
        where scope.organization_id = ${studioInterview.organizationId}
          and scope.member_id = ${member.id}
          and scope.resume_source_id = ${jobDescription.resumeSourceId}
        order by 1
      )`,
      email: user.email,
      name: user.name,
      recommendationRank: sql<number>`coalesce((
        select min(case when scope.department_id = ${jobDescription.departmentId} then 0
          when scope.department_id is null then 1 else 2 end)
        from odc_department_responsibility scope
        where scope.organization_id = ${studioInterview.organizationId}
          and scope.member_id = ${member.id}
          and scope.resume_source_id = ${jobDescription.resumeSourceId}
      ), 3)`,
      resumeSourceNames: sql<string[]>`
        case when ${member.odcScopeMode} = 'all' then array['全部部门/中心']::text[] else coalesce(
          array(
            select distinct all_source.name
            from resume_source_odc_member all_assignment
            inner join resume_source all_source
              on all_source.organization_id = all_assignment.organization_id
              and all_source.id = all_assignment.resume_source_id
            where all_assignment.organization_id = ${studioInterview.organizationId}
              and all_assignment.member_id = ${member.id}
              and all_assignment.resume_source_id = ${jobDescription.resumeSourceId}
            order by all_source.name
          ),
          array[]::text[]
        ) end
      `,
      rolePermission: organizationRole.permission,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
      userId: user.id,
    })
    .from(studioInterview)
    .innerJoin(
      jobDescription,
      and(
        eq(jobDescription.id, studioInterview.jobDescriptionId),
        eq(jobDescription.organizationId, studioInterview.organizationId),
      ),
    )
    .innerJoin(member, eq(member.organizationId, studioInterview.organizationId))
    .leftJoin(
      resumeSourceOdcMember,
      and(
        eq(resumeSourceOdcMember.memberId, member.id),
        eq(resumeSourceOdcMember.organizationId, studioInterview.organizationId),
        eq(resumeSourceOdcMember.resumeSourceId, jobDescription.resumeSourceId),
      ),
    )
    .innerJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
        eq(organizationRole.isOdc, true),
      ),
    )
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(studioInterview.id, input.candidateId),
        eq(studioInterview.organizationId, input.organizationId),
        or(
          and(eq(member.odcScopeMode, "all"), sql`${jobDescription.resumeSourceId} is not null`),
          and(
            sql`${resumeSourceOdcMember.memberId} is not null`,
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
        or(isNull(user.banned), eq(user.banned, false)),
      ),
    )
    .orderBy(asc(user.name), asc(user.id));

  return rows
    .filter((row) => hasCandidateManagementPermission(row.rolePermission))
    .toSorted((a, b) => a.recommendationRank - b.recommendationRank)
    .map((row) => {
      const recipientId = resolveTelegramRecipientId({
        boundUsername: row.telegramBoundUsername,
        chatId: row.telegramChatId,
        profileTelegram: row.telegram,
      });
      return {
        chatId: row.telegramChatId && recipientId === row.telegramChatId ? recipientId : null,
        departmentNames: row.departmentNames,
        email: row.email,
        name: row.name,
        recommendationRank: row.recommendationRank,
        resumeSourceNames: row.resumeSourceNames,
        userId: row.userId,
      };
    });
}
