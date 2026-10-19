import { and, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
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
import {
  loadAuthorizedOfferSscContext,
  OfferDraftError,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
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

export async function loadOfferCandidatePreview(token: string): Promise<{
  preview: OfferCandidatePreview;
  resumeStorageKey: string | null;
} | null> {
  const access = verifyOfferCandidatePreviewToken(token);
  if (!access) {
    return null;
  }
  let context;
  try {
    // Resolves live membership, banned state, Offer read permission and candidate visibility.
    context = await loadAuthorizedOfferSscContext({
      actorUserId: access.actorUserId,
      draftId: access.draftId,
      interviewRecordId: access.candidateId,
      organizationId: access.organizationId,
    });
  } catch (error) {
    if (error instanceof OfferDraftError && [403, 404].includes(error.status)) {
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
      candidateName: studioInterview.candidateName,
      departmentName: department.name,
      jobDescription: jobDescription.description,
      jobName: jobDescription.name,
      resumeFileName: studioInterview.resumeFileName,
      resumeProfile: studioInterview.resumeProfile,
      resumeReview: studioInterview.resumeReview,
      resumeReviewGeneratedAt: studioInterview.resumeReviewGeneratedAt,
      resumeReviewStatus: studioInterview.resumeReviewStatus,
      resumeScreeningEvaluatedAt: studioInterview.resumeScreeningEvaluatedAt,
      resumeScreeningResult: studioInterview.resumeScreeningResult,
      resumeScreeningStatus: studioInterview.resumeScreeningStatus,
      resumeStorageKey: studioInterview.resumeStorageKey,
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
      offer: {
        baseSalary: draft.baseSalary,
        bonus: draft.bonus,
        currency: draft.currency,
        equity: draft.equity,
        expiresAt: draft.expiresAt,
        id: draft.id,
        joiningDate: draft.joiningDate,
        notes: draft.notes,
        position: draft.position,
        sscCompletedAt: draft.sscCompletedAt ?? null,
        sscConfirmationStatus: draft.sscConfirmationStatus,
        sscReceivedAt: draft.sscReceivedAt ?? null,
        version: draft.version,
      },
      screening: {
        evaluatedAt: publicDate(candidate.resumeScreeningEvaluatedAt),
        result: publicScreeningResult(candidate.resumeScreeningResult),
        status: candidate.resumeScreeningStatus,
      },
    },
    resumeStorageKey: candidate.resumeStorageKey,
  };
}
