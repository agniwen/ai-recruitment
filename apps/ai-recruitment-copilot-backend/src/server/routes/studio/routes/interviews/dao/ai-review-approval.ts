import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  member,
  organizationRole,
  resumeSourceOdcMember,
} from "@arc/db-schema/schema";

type Executor = Pick<typeof db, "select">;

export async function canApproveCandidateAiReview(
  input: {
    jobDescriptionId: string | null;
    organizationId: string;
    userId: string | null;
  },
  executor: Executor = db,
): Promise<boolean> {
  if (!input.jobDescriptionId || !input.userId) {
    return false;
  }
  const rows = await executor
    .select({ memberId: member.id })
    .from(member)
    .innerJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
        eq(organizationRole.isOdc, true),
      ),
    )
    .innerJoin(
      resumeSourceOdcMember,
      and(
        eq(resumeSourceOdcMember.organizationId, member.organizationId),
        eq(resumeSourceOdcMember.memberId, member.id),
        eq(resumeSourceOdcMember.canApproveAiReview, true),
      ),
    )
    .innerJoin(
      jobDescription,
      and(
        eq(jobDescription.organizationId, member.organizationId),
        eq(jobDescription.resumeSourceId, resumeSourceOdcMember.resumeSourceId),
      ),
    )
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
        eq(jobDescription.id, input.jobDescriptionId),
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
    .limit(1);
  return rows.length > 0;
}
