import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member } from "@arc/db-schema/schema";

export const HUMAN_INTERVIEW_INTERVIEWER_REQUIRED_MESSAGE = "存在未开启面试官身份的成员。";

export async function assertWorkspaceInterviewers({
  makeError,
  organizationId,
  userIds,
}: {
  makeError: (message: string) => Error;
  organizationId: string;
  userIds: string[];
}): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) {
    return;
  }

  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.isInterviewer, true),
        inArray(member.userId, uniqueUserIds),
      ),
    );
  if (rows.length !== uniqueUserIds.length) {
    throw makeError(HUMAN_INTERVIEW_INTERVIEWER_REQUIRED_MESSAGE);
  }
}
