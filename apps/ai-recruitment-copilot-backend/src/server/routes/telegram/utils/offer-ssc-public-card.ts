import type { loadAuthorizedOfferSscContext } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { buildOfferCandidatePreviewLink } from "@arc/ai-recruitment-copilot-backend/server/routes/public/routes/offer-candidates/access";
import { buildTelegramOfferCard } from "./offer-ssc-card";

export function buildTelegramOfferPublicCard(
  context: Awaited<ReturnType<typeof loadAuthorizedOfferSscContext>>,
  actorUserId: string,
  options: { feedbackLabel?: string; title?: string } = {},
) {
  const detailUrl = buildOfferCandidatePreviewLink({
    actorUserId,
    candidateId: context.draft.interviewRecordId,
    draftId: context.draft.id,
    organizationId: context.draft.organizationId,
    revision: context.draft.sscRevision ?? 1,
  });
  return buildTelegramOfferCard(context, { ...options, detailUrl });
}
