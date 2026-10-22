import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  hiringUnit,
  jobDescription,
  studioInterview,
  studioOfferDraft,
} from "@arc/db-schema/schema";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import type { OfferCreationContext } from "@arc/shared/offer-confirmation";
import {
  buildResumeVisibilityCondition,
  resolveResumeVisibilityScope,
} from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { listHumanInterviewRounds } from "./human-interview-rounds";

const jobHiringUnit = alias(hiringUnit, "offer_creation_job_hiring_unit");
const departmentHiringUnit = alias(hiringUnit, "offer_creation_department_hiring_unit");

const resumeMediaTypes: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  webp: "image/webp",
};

export async function loadOfferCreationContext(input: {
  actorRole?: string | null;
  actorUserId: string;
  interviewRecordId: string;
  organizationId: string;
}): Promise<OfferCreationContext | null> {
  const scope = await resolveResumeVisibilityScope({
    currentRole: input.actorRole,
    organizationId: input.organizationId,
    userId: input.actorUserId,
  });
  const [candidate] = await db
    .select({
      candidateName: studioInterview.candidateName,
      creationSource: jobDescription.creationSource,
      departmentHiringUnitName: departmentHiringUnit.name,
      departmentName: department.name,
      jobHiringUnitName: jobHiringUnit.name,
      resumeFileName: studioInterview.resumeFileName,
      resumeProfile: studioInterview.resumeProfile,
      resumeStorageKey: studioInterview.resumeStorageKey,
      serviceUnit: jobDescription.serviceUnit,
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
    .leftJoin(
      jobHiringUnit,
      and(
        eq(jobHiringUnit.id, jobDescription.hiringUnitId),
        eq(jobHiringUnit.organizationId, studioInterview.organizationId),
      ),
    )
    .leftJoin(
      departmentHiringUnit,
      and(
        eq(departmentHiringUnit.id, department.hiringUnitId),
        eq(departmentHiringUnit.organizationId, studioInterview.organizationId),
      ),
    )
    .where(
      and(
        eq(studioInterview.id, input.interviewRecordId),
        eq(studioInterview.organizationId, input.organizationId),
        buildResumeVisibilityCondition(scope),
      ),
    )
    .limit(1);
  if (!candidate) {
    return null;
  }
  const authorize = createRequestWorkspaceAuthorizer({
    memberRole: input.actorRole,
    organizationId: input.organizationId,
    userId: input.actorUserId,
  });
  const [canReadInterview, canReadResume, canReadJob] = await Promise.all([
    authorize({ action: "read", resource: "humanInterview" }),
    authorize({ action: "read", resource: "resumeLibrary" }),
    authorize({ action: "read", resource: "jd" }),
  ]);
  const rounds = canReadInterview
    ? await listHumanInterviewRounds(input.interviewRecordId, input.organizationId)
    : [];
  const extension = candidate.resumeFileName?.split(".").at(-1)?.toLowerCase();
  const [previousOffer] = await db
    .select({ confirmationInfo: studioOfferDraft.confirmationInfo })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
        eq(studioOfferDraft.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  // Explicit Google blanks stay blank; manual jobs can inherit their department's unit.
  const hiringUnitName =
    candidate.creationSource === "google_sheets"
      ? candidate.jobHiringUnitName
      : (candidate.jobHiringUnitName ?? candidate.departmentHiringUnitName);
  return {
    defaults: offerConfirmationDetailsSchema.parse({
      candidateName: candidate.candidateName,
      candidatePrivateTelegram: previousOffer?.confirmationInfo?.candidatePrivateTelegram ?? null,
      departmentName: canReadJob ? candidate.departmentName : null,
      gender:
        typeof candidate.resumeProfile?.gender === "string" ? candidate.resumeProfile.gender : null,
      hiringUnitName: canReadJob ? hiringUnitName : null,
      serviceUnit: canReadJob ? candidate.serviceUnit : null,
    }),
    interviewRounds: rounds.map((round) => ({
      feedback: round.feedback,
      id: round.id,
      interviewers: [...round.interviewers, ...(round.externalInterviewers ?? [])].map(
        ({ id, name }) => ({ id, name }),
      ),
      label: round.label,
    })),
    resume: {
      available: canReadResume && Boolean(candidate.resumeStorageKey),
      filename: candidate.resumeFileName,
      mediaType: extension ? (resumeMediaTypes[extension] ?? null) : null,
    },
  };
}
