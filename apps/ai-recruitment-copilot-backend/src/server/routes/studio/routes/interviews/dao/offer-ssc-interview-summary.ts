import type { OfferInterviewRound } from "@arc/shared/offer-interviews";
import { listHumanInterviewRounds } from "./human-interview-rounds";

// Call after authorizing the Offer; keep every lookup scoped to its candidate and workspace.
export async function loadOfferSscInterviewSummary(input: {
  interviewRecordId: string;
  organizationId: string;
}): Promise<OfferInterviewRound[]> {
  const rounds = await listHumanInterviewRounds(input.interviewRecordId, input.organizationId);
  return rounds
    .filter(
      (round) =>
        round.status === "completed" &&
        round.interviewRecordId === input.interviewRecordId &&
        round.organizationId === input.organizationId,
    )
    .map((round) => ({
      feedback: round.feedback,
      interviewers: [...round.interviewers, ...(round.externalInterviewers ?? [])].map(
        ({ name }) => ({ name }),
      ),
      label: round.label,
      scheduledAt: round.scheduledAt,
      sortOrder: round.sortOrder,
      status: round.status,
    }));
}
