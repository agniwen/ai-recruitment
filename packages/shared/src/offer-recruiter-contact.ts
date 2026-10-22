export {
  candidatePrivateTelegramSchema,
  normalizeCandidatePrivateTelegram,
} from "@arc/db-schema/offer-recruiter-contact";
export type { OfferRecruiterConfirmationStatus } from "@arc/db-schema/offer-recruiter-contact";

export interface OfferRecruiterContactState {
  organizationId: string;
  interviewRecordId: string;
  draftId: string;
  revision: number;
  version: number;
  position: string;
  candidateName: string;
  candidateDetailUrl: string | null;
  status: "pending" | "completed" | null;
  candidatePrivateTelegram: string | null;
  recruiterName: string | null;
  canConfirm: boolean;
  notificationIssue: string | null;
}
