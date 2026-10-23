import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";
import {
  offerCompletionInfoSchema,
  offerCompletionPreviewSchema,
} from "@arc/db-schema/offer-completion";
import type { OfferCompletionInfo, OfferCompletionPreview } from "@arc/db-schema/offer-completion";
import { candidatePrivateTelegramSchema } from "@arc/db-schema/offer-recruiter-contact";
import type { ResumeRecruitmentSource } from "@arc/db-schema/resume-recruitment-source";
import {
  member,
  recruitingGroup,
  recruitingGroupMember,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import { resumeRecruitmentSourceMeta } from "@arc/shared/bulk-resume-upload";

function uploadedSourceDetails(source: ResumeRecruitmentSource | null, detail: string | null) {
  const sourceMeta = source ? resumeRecruitmentSourceMeta[source] : null;
  return {
    recruitmentChannel: sourceMeta?.label ?? null,
    resumeSource: detail?.trim() || sourceMeta?.label || null,
  };
}

export async function loadOfferCompletionPreview(
  input: {
    organizationId: string;
    interviewRecordId: string;
    confirmationInfo: OfferConfirmationDetails | null;
    preboardingDate: string | null;
  },
  connection: Pick<Database, "select">,
): Promise<OfferCompletionPreview> {
  const [candidate] = await connection
    .select({
      candidateName: studioInterview.candidateName,
      createdBy: studioInterview.createdBy,
      recruitmentSource: studioInterview.recruitmentSource,
      recruitmentSourceDetail: studioInterview.recruitmentSourceDetail,
    })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.interviewRecordId),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!candidate) {
    throw new Error("候选人记录不存在。");
  }
  let recruiterTelegram: string | null = null;
  let recruitingGroupNames: string[] = [];
  if (candidate.createdBy) {
    const [recruiter] = await connection
      .select({ banned: user.banned, telegram: user.telegram })
      .from(user)
      .innerJoin(
        member,
        and(eq(member.userId, user.id), eq(member.organizationId, input.organizationId)),
      )
      .where(eq(user.id, candidate.createdBy))
      .limit(1);
    if (recruiter && !recruiter.banned) {
      const telegram = candidatePrivateTelegramSchema.safeParse(recruiter.telegram);
      recruiterTelegram = telegram.success ? telegram.data : null;
      const groups = await connection
        .select({ name: recruitingGroup.name })
        .from(recruitingGroupMember)
        .innerJoin(
          recruitingGroup,
          and(
            eq(recruitingGroup.id, recruitingGroupMember.groupId),
            eq(recruitingGroup.organizationId, input.organizationId),
          ),
        )
        .where(
          and(
            eq(recruitingGroupMember.organizationId, input.organizationId),
            eq(recruitingGroupMember.userId, candidate.createdBy),
          ),
        )
        .orderBy(asc(recruitingGroup.name), asc(recruitingGroup.id));
      recruitingGroupNames = [...new Set(groups.map(({ name }) => name.trim()).filter(Boolean))];
    }
  }
  return offerCompletionPreviewSchema.parse({
    candidateCode: input.confirmationInfo?.candidateCode?.trim() || null,
    candidateName: input.confirmationInfo?.candidateName?.trim() || candidate.candidateName,
    candidatePrivateTelegram: input.confirmationInfo?.candidatePrivateTelegram ?? null,
    preboardingDate: input.preboardingDate,
    recruiterTelegram,
    recruitingGroupNames,
    ...uploadedSourceDetails(candidate.recruitmentSource, candidate.recruitmentSourceDetail),
  });
}

export async function loadOfferCompletionInfo(
  input: {
    organizationId: string;
    interviewRecordId: string;
    confirmationInfo: OfferConfirmationDetails | null;
    preboardingDate: string;
  },
  connection: Pick<Database, "select">,
): Promise<OfferCompletionInfo> {
  return offerCompletionInfoSchema.parse(await loadOfferCompletionPreview(input, connection));
}
