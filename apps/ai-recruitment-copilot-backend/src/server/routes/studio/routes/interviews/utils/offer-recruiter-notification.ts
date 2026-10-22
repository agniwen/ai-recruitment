import { and, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, studioInterview, studioOfferDraft, user } from "@arc/db-schema/schema";
import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import { normalizeTelegramUsername } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import { loadOfferRecruiterContactContext } from "../dao/offer-recruiter-contact";
import { OfferDraftError } from "../dao/offer-drafts";
import type { OfferSscNotificationInput } from "../dao/offer-ssc-notification-outbox";
import type { OfferSscNotificationTarget } from "./offer-ssc-notification";

async function loadCurrentRecruiterOffer(input: OfferSscNotificationInput) {
  // Resolve the highest version before checking status. A deleted newer version
  // must never revive a pending task or expose the old Offer to its uploader.
  const [offer] = await db
    .select({
      banned: user.banned,
      expiresAt: studioOfferDraft.expiresAt,
      id: studioOfferDraft.id,
      interviewRecordId: studioOfferDraft.interviewRecordId,
      membershipId: member.id,
      organizationId: studioOfferDraft.organizationId,
      pipelineStage: studioInterview.pipelineStage,
      recruiterConfirmationStatus: studioOfferDraft.recruiterConfirmationStatus,
      recruiterUserId: studioInterview.createdBy,
      sscRevision: studioOfferDraft.sscRevision,
      status: studioOfferDraft.status,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
      userId: user.id,
      version: studioOfferDraft.version,
    })
    .from(studioOfferDraft)
    .innerJoin(
      studioInterview,
      and(
        eq(studioInterview.id, studioOfferDraft.interviewRecordId),
        eq(studioInterview.organizationId, studioOfferDraft.organizationId),
      ),
    )
    .innerJoin(user, eq(user.id, studioInterview.createdBy))
    .innerJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, studioOfferDraft.organizationId)),
    )
    .where(
      and(
        eq(studioOfferDraft.organizationId, input.organizationId),
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  return offer;
}

type RecruiterOffer = NonNullable<Awaited<ReturnType<typeof loadCurrentRecruiterOffer>>>;

function isCurrentRecruiterOffer(
  input: OfferSscNotificationInput,
  offer: RecruiterOffer | undefined,
): offer is RecruiterOffer {
  if (!offer) {
    return false;
  }
  return (
    offer.id === input.draftId &&
    offer.organizationId === input.organizationId &&
    offer.interviewRecordId === input.interviewRecordId &&
    offer.sscRevision === input.revision &&
    offer.recruiterConfirmationStatus === "pending" &&
    offer.status === "draft" &&
    offer.pipelineStage !== "closed" &&
    (!offer.expiresAt || offer.expiresAt.getTime() > Date.now()) &&
    offer.banned !== true &&
    Boolean(offer.membershipId) &&
    Boolean(offer.recruiterUserId) &&
    offer.userId === offer.recruiterUserId
  );
}

function boundRecruiterTarget(offer: RecruiterOffer) {
  const username = normalizeTelegramUsername(offer.telegram);
  const chatId = offer.telegramChatId;
  if (
    !username ||
    !/^[a-zA-Z0-9_]{5,32}$/u.test(username) ||
    username !== normalizeTelegramUsername(offer.telegramBoundUsername) ||
    !chatId ||
    !/^[1-9]\d*$/u.test(chatId)
  ) {
    return null;
  }
  return { chatId, userId: `recruiter:${offer.userId}:telegram:${chatId}`, username };
}

function matchesRecruiterContext(
  input: OfferSscNotificationInput,
  version: number,
  context: OfferRecruiterContactState,
) {
  return (
    context.canConfirm &&
    context.status === "pending" &&
    context.draftId === input.draftId &&
    context.organizationId === input.organizationId &&
    context.interviewRecordId === input.interviewRecordId &&
    context.revision === input.revision &&
    context.version === version
  );
}

export async function getOfferRecruiterNotificationTargets(
  input: OfferSscNotificationInput,
): Promise<OfferSscNotificationTarget[]> {
  if (input.event !== "recruiter") {
    return [];
  }
  const offer = await loadCurrentRecruiterOffer(input);
  if (!isCurrentRecruiterOffer(input, offer)) {
    return [];
  }
  const target = boundRecruiterTarget(offer);
  if (!target) {
    return [];
  }
  let context;
  try {
    // Recheck the actual Telegram identity so a binding changed during target
    // resolution cannot deliver candidate information to the former account.
    context = await loadOfferRecruiterContactContext({
      draftId: input.draftId,
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
      telegramActor: { telegramUserId: target.chatId, username: target.username },
    });
  } catch (error) {
    if (error instanceof OfferDraftError && [403, 404, 409].includes(error.status)) {
      return [];
    }
    throw error;
  }
  if (!matchesRecruiterContext(input, offer.version, context)) {
    return [];
  }
  const { buildTelegramOfferRecruiterCard } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/offer-recruiter-contact");
  return [
    {
      chatId: target.chatId,
      message: buildTelegramOfferRecruiterCard(context),
      userId: target.userId,
    },
  ];
}
