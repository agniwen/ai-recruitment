import type { OfferSscTelegramActor } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { buildOfferCandidatePreviewLink } from "@arc/ai-recruitment-copilot-backend/server/routes/public/routes/offer-candidates/access";
import type { TelegramOfferCardContext } from "./offer-ssc-card";
import {
  buildTelegramOfferCard,
  buildTelegramOfferCompletionCard,
  telegramOfferCallbackValue,
} from "./offer-ssc-card";

type PublicCardContext = TelegramOfferCardContext & {
  draft: { organizationId: string; interviewRecordId: string };
};

function candidateLink(context: PublicCardContext, actor: string | OfferSscTelegramActor) {
  return buildOfferCandidatePreviewLink({
    ...(typeof actor === "string" ? { actorUserId: actor } : { telegramActor: actor }),
    candidateId: context.draft.interviewRecordId,
    draftId: context.draft.id,
    organizationId: context.draft.organizationId,
    revision: context.draft.sscRevision ?? 1,
  });
}

export function buildTelegramOfferPublicCard(
  context: PublicCardContext,
  actor: string | OfferSscTelegramActor,
  options: { feedbackLabel?: string; title?: string } = {},
) {
  return buildTelegramOfferCard(context, { ...options, detailUrl: candidateLink(context, actor) });
}

export function buildTelegramOfferPublicCompletionCard(
  context: PublicCardContext,
  actor: OfferSscTelegramActor,
  feedbackLabel: string,
) {
  return buildTelegramOfferCompletionCard(
    context,
    telegramOfferCallbackValue(context.draft.id, context.draft.sscRevision ?? 1),
    { detailUrl: candidateLink(context, actor), feedbackLabel, persistent: true },
  );
}
