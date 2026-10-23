import { and, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  hiringUnit,
  jobDescription,
  studioInterview,
  studioOfferDraft,
} from "@arc/db-schema/schema";
import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import { resumeReviewLooseSchema } from "@arc/db-schema/resume-review";
import type {
  OfferCandidatePreview,
  OfferCandidateResumeProfile,
  OfferCandidateScreeningResult,
} from "@arc/shared/offer-candidate-preview";
import { resumeScreeningResultSchema } from "@arc/shared/resume-screening";
import { describeResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import { describeResumeEvaluationStatus } from "@arc/shared/studio-resumes";
import { loadCandidateTimeline } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/timeline";
import {
  loadAuthorizedOfferSscContext,
  OfferDraftError,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import type { OfferDraftRecord } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { listHumanInterviewRounds } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds";
import { verifyOfferCandidatePreviewToken } from "./access";

function publicProfile(value: unknown): OfferCandidateResumeProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const parsed = resumeProfileSchema.safeParse({ ...value, scoringFacts: undefined });
  if (!parsed.success) {
    return null;
  }
  const profile = parsed.data;
  return {
    age: profile.age,
    educationExperiences: profile.educationExperiences,
    email: profile.email,
    gender: profile.gender,
    name: profile.name,
    personalStrengths: profile.personalStrengths,
    phone: profile.phone,
    projectExperiences: profile.projectExperiences,
    schools: profile.schools,
    skills: profile.skills,
    targetRoles: profile.targetRoles,
    workExperiences: profile.workExperiences,
    workYears: profile.workYears,
  };
}

function publicDate(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function publicReview(value: unknown) {
  const parsed = resumeReviewLooseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function publicScreeningResult(value: unknown): OfferCandidateScreeningResult | null {
  const parsed = resumeScreeningResultSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return {
    policyEmpty: parsed.data.policyEmpty,
    recommendation: parsed.data.recommendation,
    ruleResults: parsed.data.ruleResults.map((rule) => ({
      evidence: rule.evidence.map((evidence) => ({
        explanation: evidence.explanation,
        ...(evidence.quote === undefined ? {} : { quote: evidence.quote }),
      })),
      label: rule.label,
      reason: rule.reason,
      severity: rule.severity,
      status: rule.status,
    })),
  };
}

const publicTimelineLabels = new Set([
  "轮次",
  "状态",
  "岗位",
  "结论",
  "前一阶段",
  "原阶段",
  "新阶段",
  "版本",
]);

function publicCandidateInfo(
  candidate: Pick<
    typeof studioInterview.$inferSelect,
    | "candidateEmail"
    | "candidatePhone"
    | "targetRole"
    | "recommendationText"
    | "recruitmentSource"
    | "recruitmentSourceDetail"
    | "resumeEvaluationStatus"
  > & { hiringUnitName: string | null },
) {
  return {
    email: candidate.candidateEmail ?? null,
    hiringUnitName: candidate.hiringUnitName ?? null,
    phone: candidate.candidatePhone ?? null,
    recommendationText: candidate.recommendationText ?? null,
    recruitmentSourceLabel: describeResumeRecruitmentSource(
      candidate.recruitmentSource,
      candidate.recruitmentSourceDetail,
    ),
    resumeEvaluationLabel: describeResumeEvaluationStatus(candidate.resumeEvaluationStatus).label,
    targetRole: candidate.targetRole ?? null,
  };
}

async function publicTimeline(candidateId: string, organizationId: string) {
  // The caller has already checked live membership and this candidate's visibility.
  const timeline = await loadCandidateTimeline(candidateId, organizationId, { kind: "all" });
  return (timeline?.events ?? []).map((event) => ({
    actorName: event.actorName,
    kind: event.kind,
    metadata: event.metadata
      .filter((entry) => publicTimelineLabels.has(entry.label))
      .map(({ label, value }) => ({ label, value })),
    occurredAt: event.occurredAt,
    title: event.title,
    tone: event.tone,
  }));
}

function publicOffer(
  draft: OfferDraftRecord,
  sscConfirmationStatus: OfferCandidatePreview["offer"]["sscConfirmationStatus"],
): OfferCandidatePreview["offer"] {
  return {
    baseSalary: draft.baseSalary,
    bonus: draft.bonus,
    completionInfo: draft.completionInfo ?? null,
    confirmationInfo: draft.confirmationInfo ?? null,
    currency: draft.currency,
    equity: draft.equity,
    expiresAt: draft.expiresAt,
    id: draft.id,
    joiningDate: draft.joiningDate,
    notes: draft.notes,
    position: draft.position,
    preboardingDate: draft.preboardingDate ?? null,
    sscCompletedAt: draft.sscCompletedAt ?? null,
    sscConfirmationStatus,
    sscReceivedAt: draft.sscReceivedAt ?? null,
    version: draft.version,
  };
}

export async function loadOfferCandidatePreview(
  token: string,
  includeTimeline = false,
): Promise<{
  preview: OfferCandidatePreview;
  resumeStorageKey: string | null;
} | null> {
  const access = verifyOfferCandidatePreviewToken(token);
  if (!access) {
    return null;
  }
  let context;
  try {
    // TG links use the live source responsibility; system links retain workspace permissions.
    context = await loadAuthorizedOfferSscContext({
      ...access,
      draftId: access.draftId,
      interviewRecordId: access.candidateId,
      organizationId: access.organizationId,
    });
  } catch (error) {
    if (error instanceof OfferDraftError && [403, 404, 409].includes(error.status)) {
      return null;
    }
    throw error;
  }
  const { draft } = context;
  if (
    draft.id !== access.draftId ||
    draft.organizationId !== access.organizationId ||
    draft.interviewRecordId !== access.candidateId ||
    draft.sscRevision !== access.revision ||
    !draft.sscConfirmationStatus ||
    !["draft", "sent", "accepted"].includes(draft.status) ||
    (draft.expiresAt && new Date(draft.expiresAt).getTime() <= Date.now())
  ) {
    return null;
  }
  // Include all versions and tombstones: deleting a newer Offer cannot revive an old link.
  const [latest] = await db
    .select({ id: studioOfferDraft.id })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.organizationId, access.organizationId),
        eq(studioOfferDraft.interviewRecordId, access.candidateId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  if (latest?.id !== access.draftId) {
    return null;
  }
  const [candidate] = await db
    .select({
      candidateEmail: studioInterview.candidateEmail,
      candidateName: studioInterview.candidateName,
      candidatePhone: studioInterview.candidatePhone,
      departmentName: department.name,
      hiringUnitName: hiringUnit.name,
      jobDescription: jobDescription.description,
      jobName: jobDescription.name,
      recommendationText: studioInterview.recommendationText,
      recruitmentSource: studioInterview.recruitmentSource,
      recruitmentSourceDetail: studioInterview.recruitmentSourceDetail,
      resumeEvaluationStatus: studioInterview.resumeEvaluationStatus,
      resumeFileName: studioInterview.resumeFileName,
      resumeProfile: studioInterview.resumeProfile,
      resumeReview: studioInterview.resumeReview,
      resumeReviewGeneratedAt: studioInterview.resumeReviewGeneratedAt,
      resumeReviewStatus: studioInterview.resumeReviewStatus,
      resumeScreeningEvaluatedAt: studioInterview.resumeScreeningEvaluatedAt,
      resumeScreeningResult: studioInterview.resumeScreeningResult,
      resumeScreeningStatus: studioInterview.resumeScreeningStatus,
      resumeStorageKey: studioInterview.resumeStorageKey,
      targetRole: studioInterview.targetRole,
    })
    .from(studioInterview)
    .leftJoin(
      jobDescription,
      and(
        eq(jobDescription.id, studioInterview.jobDescriptionId),
        eq(jobDescription.organizationId, studioInterview.organizationId),
      ),
    )
    .leftJoin(
      hiringUnit,
      and(
        eq(hiringUnit.id, studioInterview.hiringUnitId),
        eq(hiringUnit.organizationId, studioInterview.organizationId),
      ),
    )
    .leftJoin(
      department,
      and(
        eq(department.id, jobDescription.departmentId),
        eq(department.organizationId, studioInterview.organizationId),
      ),
    )
    .where(
      and(
        eq(studioInterview.id, access.candidateId),
        eq(studioInterview.organizationId, access.organizationId),
      ),
    )
    .limit(1);
  if (!candidate) {
    return null;
  }
  const review = publicReview(candidate.resumeReview);
  const humanRounds = await listHumanInterviewRounds(access.candidateId, access.organizationId);
  return {
    preview: {
      aiReview: {
        generatedAt: publicDate(candidate.resumeReviewGeneratedAt),
        review,
        status: candidate.resumeReviewStatus,
      },
      candidate: {
        hasResumeFile: Boolean(candidate.resumeStorageKey),
        id: access.candidateId,
        info: publicCandidateInfo(candidate),
        name: candidate.candidateName,
        profile: publicProfile(candidate.resumeProfile),
        resumeFileName: candidate.resumeFileName,
      },
      humanInterviews: humanRounds.map((round) => ({
        cancelledAt: round.cancelledAt,
        completedAt: round.completedAt,
        feedback: round.feedback,
        format: round.format,
        interviewers: [
          ...round.interviewers.map(({ name }) => ({ name })),
          ...(round.externalInterviewers ?? []).map(({ name }) => ({ name })),
        ],
        label: round.label,
        outcome: round.outcome,
        scheduledAt: round.scheduledAt,
        score: round.score,
        sortOrder: round.sortOrder,
        status: round.status,
      })),
      job: {
        departmentName: candidate.departmentName,
        description: candidate.jobDescription,
        name: candidate.jobName,
      },
      linkExpiresAt: new Date(access.exp).toISOString(),
      offer: publicOffer(draft, draft.sscConfirmationStatus),
      screening: {
        evaluatedAt: publicDate(candidate.resumeScreeningEvaluatedAt),
        result: publicScreeningResult(candidate.resumeScreeningResult),
        status: candidate.resumeScreeningStatus,
      },
      timeline: includeTimeline
        ? await publicTimeline(access.candidateId, access.organizationId)
        : [],
    },
    resumeStorageKey: candidate.resumeStorageKey,
  };
}
