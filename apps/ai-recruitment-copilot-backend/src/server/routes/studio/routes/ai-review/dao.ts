import { and, asc, eq, isNull, or } from "drizzle-orm";
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
      email: user.email,
      name: user.name,
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
    .innerJoin(
      resumeSourceOdcMember,
      and(
        eq(resumeSourceOdcMember.organizationId, studioInterview.organizationId),
        eq(resumeSourceOdcMember.resumeSourceId, jobDescription.resumeSourceId),
        or(
          isNull(resumeSourceOdcMember.jobSeries),
          eq(resumeSourceOdcMember.jobSeries, jobDescription.jobSeries),
        ),
        or(
          isNull(resumeSourceOdcMember.serviceUnit),
          eq(resumeSourceOdcMember.serviceUnit, jobDescription.serviceUnit),
        ),
      ),
    )
    .innerJoin(
      member,
      and(
        eq(member.id, resumeSourceOdcMember.memberId),
        eq(member.organizationId, studioInterview.organizationId),
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
        or(isNull(user.banned), eq(user.banned, false)),
      ),
    )
    .orderBy(asc(user.name), asc(user.id));

  return rows
    .filter((row) => hasCandidateManagementPermission(row.rolePermission))
    .map((row) => {
      const recipientId = resolveTelegramRecipientId({
        boundUsername: row.telegramBoundUsername,
        chatId: row.telegramChatId,
        profileTelegram: row.telegram,
      });
      return {
        chatId: row.telegramChatId && recipientId === row.telegramChatId ? recipientId : null,
        email: row.email,
        name: row.name,
        userId: row.userId,
      };
    });
}
