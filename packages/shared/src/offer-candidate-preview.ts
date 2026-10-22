import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { ResumeReviewLoose } from "@arc/db-schema/resume-review";
import type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";
import type {
  HumanInterviewFormat,
  HumanInterviewRoundOutcome,
  HumanInterviewRoundStatus,
  OfferSscConfirmationStatus,
  ResumeReviewStatus,
  ResumeScreeningStatus,
} from "@arc/db-schema/studio-interviews";
import type {
  ResumeScreeningRecommendation,
  ResumeScreeningRuleSeverity,
  ResumeScreeningRuleStatus,
} from "./resume-screening";
import type { CandidateTimelineEvent } from "./studio-resumes";

export type OfferCandidateActivity = Pick<
  CandidateTimelineEvent,
  "kind" | "tone" | "title" | "occurredAt" | "actorName" | "metadata"
>;

export type OfferCandidateResumeProfile = Pick<
  ResumeProfile,
  | "age"
  | "educationExperiences"
  | "email"
  | "gender"
  | "name"
  | "personalStrengths"
  | "phone"
  | "projectExperiences"
  | "schools"
  | "skills"
  | "targetRoles"
  | "workExperiences"
  | "workYears"
>;

export interface OfferCandidateHumanInterview {
  label: string;
  sortOrder: number;
  format: HumanInterviewFormat;
  status: HumanInterviewRoundStatus;
  outcome: HumanInterviewRoundOutcome | null;
  score: number | null;
  feedback: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  interviewers: { name: string }[];
}

export interface OfferCandidateScreeningResult {
  policyEmpty: boolean;
  recommendation: ResumeScreeningRecommendation;
  ruleResults: {
    label: string;
    reason: string;
    severity: ResumeScreeningRuleSeverity;
    status: ResumeScreeningRuleStatus;
    evidence: { explanation: string; quote?: string }[];
  }[];
}

export interface OfferCandidatePreview {
  candidate: {
    id?: string;
    info?: {
      email: string | null;
      phone: string | null;
      targetRole: string | null;
      hiringUnitName: string | null;
      recruitmentSourceLabel: string | null;
      resumeEvaluationLabel: string | null;
      recommendationText: string | null;
    };
    name: string;
    profile: OfferCandidateResumeProfile | null;
    resumeFileName: string | null;
    hasResumeFile: boolean;
  };
  job: {
    name: string | null;
    departmentName: string | null;
    description: string | null;
  };
  aiReview: {
    status: ResumeReviewStatus;
    generatedAt: string | null;
    review: ResumeReviewLoose | null;
  };
  screening: {
    status: ResumeScreeningStatus;
    evaluatedAt: string | null;
    result: OfferCandidateScreeningResult | null;
  };
  humanInterviews: OfferCandidateHumanInterview[];
  timeline?: OfferCandidateActivity[];
  offer: {
    confirmationInfo?: OfferConfirmationDetails | null;
    id: string;
    version: number;
    position: string;
    baseSalary: number;
    bonus: number | null;
    equity: string | null;
    currency: string;
    joiningDate: string | null;
    expiresAt: string | null;
    notes: string | null;
    sscConfirmationStatus: OfferSscConfirmationStatus;
    sscReceivedAt: string | null;
    sscCompletedAt: string | null;
  };
  linkExpiresAt: string;
}
