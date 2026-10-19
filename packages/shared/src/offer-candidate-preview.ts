import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { OfferSscConfirmationStatus } from "@arc/db-schema/studio-interviews";

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

export interface OfferCandidatePreview {
  candidate: {
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
  offer: {
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
