import type { PipelineStage, CandidateOutcome } from "./studio-interviews";
export type ResumeAdmissionStatus = "accepted" | "pending" | "protected";

export interface ResumeProtectionSummary {
  checkedAt: string;
  cycleId: string;
  durationDays: number;
  expiresAt: string;
  hiringUnitNames: string[];
  matchBasis: string;
  ownerName: string;
  ownerUserId: string;
  startsAt: string;
}

export interface ResumeProtectionIdentity {
  contentHash: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
}

export interface ResumeProtectionDetails {
  protection: ResumeProtectionSummary;
  recommendations: {
    hiringUnitName: string | null;
    targetRole: string | null;
    recommendedAt: string;
    pipelineStage: PipelineStage | null;
    outcome: CandidateOutcome | null;
  }[];
}
