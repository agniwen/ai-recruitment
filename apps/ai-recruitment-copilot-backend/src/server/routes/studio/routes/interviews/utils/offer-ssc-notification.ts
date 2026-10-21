import type { AdapterPostableMessage } from "chat";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, studioOfferDraft, user } from "@arc/db-schema/schema";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { loadAuthorizedOfferSscContext, OfferDraftError } from "../dao/offer-drafts";
import { buildTelegramOfferPublicCard } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/offer-ssc-public-card";
import { normalizeTelegramUsername } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import type { OfferSscNotificationInput } from "../dao/offer-ssc-notification-outbox";
import { listSourceSscNotificationRecipients } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/ssc-notification-recipients";
import { buildTelegramOfferCard } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/offer-ssc-card";

export type { OfferSscNotificationInput } from "../dao/offer-ssc-notification-outbox";

export interface OfferSscNotificationTarget {
  // Pending notifications use telegram:<chatId>; feedback retains the creator's user ID.
  userId: string;
  chatId: string;
  message: AdapterPostableMessage;
}

type NotificationOfferState = Pick<
  OfferDraftRecord,
  "id" | "organizationId" | "interviewRecordId" | "sscRevision" | "sscConfirmationStatus" | "status"
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
): Promise<OfferSscNotificationTarget | null> {
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
  const cardContext = { ...context, canConfirm: false, canReceive: false };
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

export async function getOfferSscNotificationTargets(
  input: OfferSscNotificationInput,
): Promise<OfferSscNotificationTarget[]> {
  // Include deleted and superseded versions: a tombstone must never revive an older Offer.
  const [offer] = await db
    .select({
      createdBy: studioOfferDraft.createdBy,
      expiresAt: studioOfferDraft.expiresAt,
      id: studioOfferDraft.id,
      interviewRecordId: studioOfferDraft.interviewRecordId,
      organizationId: studioOfferDraft.organizationId,
      position: studioOfferDraft.position,
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
  if (
    !offer ||
    !isCurrentNotificationState(input, offer) ||
    (input.event !== "pending" && !offer.createdBy)
  ) {
    return [];
  }
  const organization = await db.query.organization.findFirst({
    columns: { slug: true },
    where: { id: input.organizationId },
  });
  if (!organization) {
    return [];
  }
  if (input.event === "pending") {
    const recipients = await listSourceSscNotificationRecipients({
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
    });
    const base = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
    if (!base) {
      throw new Error("Offer notification public URL is not configured");
    }
    const detailUrl = new URL(
      `/w/${encodeURIComponent(organization.slug)}/studio/resumes/${encodeURIComponent(input.interviewRecordId)}?stage=offer`,
      base,
    ).toString();
    const seen = new Set<string>();
    return recipients.flatMap((recipient) => {
      if (seen.has(recipient.chatId)) {
        return [];
      }
      seen.add(recipient.chatId);
      return [
        {
          chatId: recipient.chatId,
          message: buildTelegramOfferCard(
            {
              ...recipient,
              canConfirm: false,
              canReceive: true,
              draft: offer,
            },
            {
              detailLabel: "登录系统查看并审核",
              detailUrl,
              title: notificationTitles.pending,
            },
          ),
          userId: `telegram:${recipient.chatId}`,
        },
      ];
    });
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
  const targets: OfferSscNotificationTarget[] = [];
  const chats = new Set<string>();
  for (const profile of profiles) {
    const target = await getAuthorizedNotificationTarget(input, profile, offer.createdBy);
    if (target && !chats.has(target.chatId)) {
      chats.add(target.chatId);
      targets.push(target);
    }
  }
  return targets;
}
