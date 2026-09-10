import { and, eq } from "drizzle-orm";
import { Actions, Card, Field, Fields, LinkButton } from "chat";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import { resolveTelegramRecipientId } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import { jobDescription, member, organization, studioInterview, user } from "@arc/db-schema/schema";
import { buildCandidateDetailUrl } from "../../interviews/utils/candidate-stage-notification";

interface PendingReviewInput {
  candidateId: string;
  organizationId: string;
}

async function sendAiReviewPending(input: PendingReviewInput): Promise<void> {
  const [candidate] = await db
    .select({
      candidateName: studioInterview.candidateName,
      jobDescriptionName: jobDescription.name,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      outcome: studioInterview.outcome,
      pipelineStage: studioInterview.pipelineStage,
      resumeReviewStatus: studioInterview.resumeReviewStatus,
    })
    .from(studioInterview)
    .innerJoin(organization, eq(studioInterview.organizationId, organization.id))
    .leftJoin(jobDescription, eq(studioInterview.jobDescriptionId, jobDescription.id))
    .where(
      and(
        eq(studioInterview.id, input.candidateId),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (
    !candidate ||
    candidate.pipelineStage !== "ai_review" ||
    candidate.outcome !== "in_pipeline" ||
    candidate.resumeReviewStatus !== "ready"
  ) {
    return;
  }
  const detailUrl = buildCandidateDetailUrl(input.candidateId, candidate.organizationSlug, true);
  if (!detailUrl) {
    throw new Error("AI 审批通知缺少应用基础 URL");
  }
  const members = await db
    .select({
      role: member.role,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
      userId: user.id,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, input.organizationId), eq(user.banned, false)));
  const recipientIds = new Set<string>();
  for (const recipient of members) {
    const chatId = resolveTelegramRecipientId({
      boundUsername: recipient.telegramBoundUsername,
      chatId: recipient.telegramChatId,
      profileTelegram: recipient.telegram,
    });
    if (!chatId) {
      continue;
    }
    const authorize = createRequestWorkspaceAuthorizer({
      memberRole: recipient.role,
      organizationId: input.organizationId,
      userId: recipient.userId,
    });
    if (await authorize({ action: "approve", resource: "aiReview" })) {
      recipientIds.add(chatId);
    }
  }
  const message = Card({
    children: [
      Fields([
        Field({ label: "候选人", value: candidate.candidateName }),
        Field({ label: "岗位", value: candidate.jobDescriptionName ?? "未关联岗位" }),
        Field({ label: "招聘主体", value: candidate.organizationName }),
        Field({ label: "状态", value: "AI 评分已完成，请审核评价结果" }),
      ]),
      Actions([LinkButton({ label: "查看候选人详情", url: detailUrl })]),
    ],
    title: "简历AI评分推荐-待审批",
  });
  const results = await Promise.allSettled(
    [...recipientIds].map((id) => postTelegramDirectMessage(id, message)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[telegram] failed to deliver AI review notification", {
        ...input,
        error: result.reason,
      });
    }
  }
}

/** Call only after a fresh assessment has committed; notification errors must not fail scoring. */
export async function notifyAiReviewPending(input: PendingReviewInput): Promise<void> {
  try {
    if (isTelegramBotConfigured()) {
      await sendAiReviewPending(input);
    }
  } catch (error) {
    console.error("[telegram] failed to send AI review notification", { ...input, error });
  }
}
