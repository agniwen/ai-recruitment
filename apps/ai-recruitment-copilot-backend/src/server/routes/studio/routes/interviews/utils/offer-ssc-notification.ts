import type { AdapterPostableMessage } from "chat";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, studioOfferDraft, user } from "@arc/db-schema/schema";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { loadOfferSscActivity } from "../dao/offer-ssc-activity";
import { loadOfferSscInterviewSummary } from "../dao/offer-ssc-interview-summary";
import type { OfferSscActivity } from "../dao/offer-ssc-activity";
import { loadAuthorizedOfferSscContext, OfferDraftError } from "../dao/offer-drafts";
import {
  buildTelegramOfferPublicCard,
  buildTelegramOfferPublicCompletionCard,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/offer-ssc-public-card";
import { normalizeTelegramUsername } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import type { OfferSscNotificationInput } from "../dao/offer-ssc-notification-outbox";
import { listSourceSscNotificationRecipients } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/ssc-notification-recipients";

export type { OfferSscNotificationInput } from "../dao/offer-ssc-notification-outbox";

export interface OfferSscNotificationTarget {
  // SSC notifications use telegram:<chatId>; creator-only feedback retains its user ID.
  userId: string;
  chatId: string;
  message: AdapterPostableMessage;
}

type NotificationOfferState = Pick<
  OfferDraftRecord,
  | "id"
  | "organizationId"
  | "interviewRecordId"
  | "sscRevision"
  | "sscConfirmationStatus"
  | "status"
  | "recruiterConfirmationStatus"
> & { expiresAt: Date | string | null };

const expectedStates = {
  completed: "completed",
  pending: "pending",
  received: "confirming",
} as const;
const notificationTitles = {
  completed: "SSC已完成Offer确认",
  pending: "Offer待SSC接收确认",
  received: "SSC已接收Offer",
} as const;
const feedbackLabels = {
  completed: "SSC完成确认",
  pending: "",
  received: "SSC接收确认",
} as const;

function isCurrentNotificationState(
  input: OfferSscNotificationInput,
  offer: NotificationOfferState,
) {
  if (input.event === "recruiter" || offer.recruiterConfirmationStatus === "pending") {
    return false;
  }
  const matchesStatus =
    offer.sscConfirmationStatus === expectedStates[input.event] ||
    (input.event === "received" && offer.sscConfirmationStatus === "completed");
  if (
    offer.id !== input.draftId ||
    offer.organizationId !== input.organizationId ||
    offer.interviewRecordId !== input.interviewRecordId ||
    offer.sscRevision !== input.revision ||
    !matchesStatus
  ) {
    return false;
  }
  if (input.event !== "pending") {
    return ["draft", "sent", "accepted"].includes(offer.status);
  }
  return (
    offer.status === "draft" &&
    (!offer.expiresAt || new Date(offer.expiresAt).getTime() > Date.now())
  );
}

function boundChatId(profile: {
  telegram: string | null;
  telegramBoundUsername: string | null;
  telegramChatId: string | null;
}) {
  const username = normalizeTelegramUsername(profile.telegram);
  return username &&
    /^[a-zA-Z0-9_]{5,32}$/u.test(username) &&
    username === normalizeTelegramUsername(profile.telegramBoundUsername) &&
    profile.telegramChatId &&
    /^[1-9]\d*$/u.test(profile.telegramChatId)
    ? profile.telegramChatId
    : null;
}

type NotificationProfile = Pick<
  typeof user.$inferSelect,
  "banned" | "telegram" | "telegramBoundUsername" | "telegramChatId"
> & { organizationId: string; userId: string };

async function getAuthorizedNotificationTarget(
  input: OfferSscNotificationInput,
  profile: NotificationProfile,
  createdBy: string | null,
  activity: OfferSscActivity[],
): Promise<OfferSscNotificationTarget | null> {
  if (input.event === "recruiter") {
    return null;
  }
  if (
    profile.organizationId !== input.organizationId ||
    profile.banned ||
    profile.userId !== createdBy
  ) {
    return null;
  }
  const chatId = boundChatId(profile);
  if (!chatId) {
    return null;
  }
  let context;
  try {
    context = await loadAuthorizedOfferSscContext({
      actorUserId: profile.userId,
      draftId: input.draftId,
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
    });
  } catch (error) {
    if (error instanceof OfferDraftError && (error.status === 403 || error.status === 404)) {
      return null;
    }
    throw error;
  }
  if (!isCurrentNotificationState(input, context.draft)) {
    return null;
  }
  const cardContext = {
    ...context,
    activity,
    canConfirm: false,
    canReceive: false,
    interviewRounds: undefined,
  };
  const message = buildTelegramOfferPublicCard(cardContext, profile.userId, {
    feedbackLabel: feedbackLabels[input.event],
    title: notificationTitles[input.event],
  });
  return {
    chatId,
    message,
    userId: profile.userId,
  };
}

function flowFeedback(input: OfferSscNotificationInput, activity: OfferSscActivity[]) {
  if (input.event === "pending" || input.event === "recruiter") {
    return "";
  }
  const action = input.event === "received" ? "offer_ssc_received" : "offer_ssc_completed";
  const operator = activity.findLast((entry) => entry.action === action)?.operator ?? "SSC";
  return `${operator}${input.event === "received" ? "已接收，待完成内部审批确认" : "已完成确认"}`;
}

export async function getOfferSscNotificationTargets(
  input: OfferSscNotificationInput,
): Promise<OfferSscNotificationTarget[]> {
  if (input.event === "recruiter") {
    const { getOfferRecruiterNotificationTargets } = await import("./offer-recruiter-notification");
    return await getOfferRecruiterNotificationTargets(input);
  }
  // Include deleted and superseded versions: a tombstone must never revive an older Offer.
  const [offer] = await db
    .select({
      baseSalary: studioOfferDraft.baseSalary,
      confirmationInfo: studioOfferDraft.confirmationInfo,
      createdBy: studioOfferDraft.createdBy,
      currency: studioOfferDraft.currency,
      expiresAt: studioOfferDraft.expiresAt,
      id: studioOfferDraft.id,
      interviewRecordId: studioOfferDraft.interviewRecordId,
      organizationId: studioOfferDraft.organizationId,
      position: studioOfferDraft.position,
      recruiterConfirmationStatus: studioOfferDraft.recruiterConfirmationStatus,
      sscConfirmationStatus: studioOfferDraft.sscConfirmationStatus,
      sscRevision: studioOfferDraft.sscRevision,
      status: studioOfferDraft.status,
      version: studioOfferDraft.version,
    })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.organizationId, input.organizationId),
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  if (!offer || !isCurrentNotificationState(input, offer)) {
    return [];
  }
  const organization = await db.query.organization.findFirst({
    columns: { slug: true },
    where: { id: input.organizationId },
  });
  if (!organization) {
    return [];
  }
  const recipients = await listSourceSscNotificationRecipients({
    interviewRecordId: input.interviewRecordId,
    organizationId: input.organizationId,
  });
  const activity = input.event === "pending" ? [] : await loadOfferSscActivity(offer);
  const feedbackLabel = flowFeedback(
    offer.sscConfirmationStatus === "completed" ? { ...input, event: "completed" } : input,
    activity,
  );
  const uniqueRecipients = new Map(recipients.map((recipient) => [recipient.chatId, recipient]));
  const interviewRounds = uniqueRecipients.size
    ? await loadOfferSscInterviewSummary({
        interviewRecordId: offer.interviewRecordId,
        organizationId: offer.organizationId,
      })
    : [];
  const unexpired = !offer.expiresAt || new Date(offer.expiresAt).getTime() > Date.now();
  const notificationTitle =
    notificationTitles[offer.sscConfirmationStatus === "completed" ? "completed" : input.event];
  const targets: OfferSscNotificationTarget[] = [...uniqueRecipients.values()].map((recipient) => {
    const actor = { telegramUserId: recipient.chatId, username: recipient.username };
    const context = {
      ...recipient,
      activity,
      canConfirm: unexpired,
      canReceive: unexpired,
      draft: offer,
      interviewRounds,
    };
    const message =
      input.event === "received" &&
      offer.sscConfirmationStatus === "confirming" &&
      offer.status === "draft" &&
      unexpired
        ? buildTelegramOfferPublicCompletionCard(context, actor, feedbackLabel)
        : buildTelegramOfferPublicCard(context, actor, {
            feedbackLabel,
            title: notificationTitle,
          });
    return { chatId: recipient.chatId, message, userId: `telegram:${recipient.chatId}` };
  });
  if (input.event === "pending" || !offer.createdBy) {
    return targets;
  }
  const profiles = await db
    .select({
      banned: user.banned,
      organizationId: member.organizationId,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
      userId: user.id,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, input.organizationId), eq(user.id, offer.createdBy ?? "")))
    .orderBy(asc(user.id));
  const chats = new Set(targets.map((target) => target.chatId));
  for (const profile of profiles) {
    const chatId = boundChatId(profile);
    if (chatId && chats.has(chatId)) {
      continue;
    }
    const target = await getAuthorizedNotificationTarget(input, profile, offer.createdBy, activity);
    if (target && !chats.has(target.chatId)) {
      chats.add(target.chatId);
      targets.push(target);
    }
  }
  return targets;
}
