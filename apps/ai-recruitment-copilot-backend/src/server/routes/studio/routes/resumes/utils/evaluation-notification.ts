import { and, eq } from "drizzle-orm";
import { Actions, Card, Divider, Field, Fields, LinkButton } from "chat";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  buildCandidateDetailUrl,
  resolveCandidateRecruitingNotificationRecipientIds,
  resolveCandidateStageNotificationRecipientIds,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-stage-notification";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import { jobDescription, organization, studioInterview, user } from "@arc/db-schema/schema";

type EvaluationRejectionKind = "ai_review" | "resume_evaluation";

interface EvaluationRejectionNotificationInput {
  candidateId: string;
  kind: EvaluationRejectionKind;
  operatorName: string;
  organizationId: string;
  reason?: string | null;
}

interface EvaluationRejectionCardInput {
  candidateName: string;
  detailUrl: string | null;
  jobDescriptionName: string | null;
  kind: EvaluationRejectionKind;
  operatorName: string;
  organizationName: string;
  reason?: string | null;
}

export function buildEvaluationRejectionNotification(input: EvaluationRejectionCardInput) {
  const isAiReview = input.kind === "ai_review";
  const fields = Fields([
    Field({ label: "候选人", value: input.candidateName }),
    Field({ label: "岗位", value: input.jobDescriptionName ?? "未关联岗位" }),
    Field({ label: "招聘主体", value: input.organizationName }),
    Field({ label: "审核人", value: input.operatorName }),
    Field({ label: isAiReview ? "审核结果" : "评估结果", value: "不通过" }),
    Field({ label: "原因", value: input.reason?.trim() || "未填写" }),
    Field({
      label: "后续处理",
      value: isAiReview ? "请检查并调整候选人的 AI 评价信息" : "该简历筛选结果已更新",
    }),
  ]);

  return Card({
    children: input.detailUrl
      ? [
          fields,
          Divider(),
          Actions([LinkButton({ label: "查看候选人详情", url: input.detailUrl })]),
        ]
      : [fields],
    title: isAiReview ? "⚠️ AI 评价审核未通过" : "⚠️ 简历评估未通过",
  });
}

async function sendEvaluationRejectionNotification(
  input: EvaluationRejectionNotificationInput,
): Promise<void> {
  const [candidate] = await db
    .select({
      candidateName: studioInterview.candidateName,
      jobDescriptionName: jobDescription.name,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      resumeContact: jobDescription.resumeContact,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
    })
    .from(studioInterview)
    .leftJoin(user, eq(studioInterview.createdBy, user.id))
    .leftJoin(jobDescription, eq(studioInterview.jobDescriptionId, jobDescription.id))
    .innerJoin(organization, eq(studioInterview.organizationId, organization.id))
    .where(
      and(
        eq(studioInterview.id, input.candidateId),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!candidate) {
    return;
  }

  const recipientIds =
    input.kind === "ai_review"
      ? await resolveCandidateRecruitingNotificationRecipientIds({
          creator: candidate,
          organizationId: input.organizationId,
          resumeContact: candidate.resumeContact,
        })
      : resolveCandidateStageNotificationRecipientIds([candidate]);
  if (recipientIds.length === 0) {
    return;
  }

  const message = buildEvaluationRejectionNotification({
    candidateName: candidate.candidateName,
    detailUrl: buildCandidateDetailUrl(input.candidateId, candidate.organizationSlug),
    jobDescriptionName: candidate.jobDescriptionName,
    kind: input.kind,
    operatorName: input.operatorName,
    organizationName: candidate.organizationName,
    reason: input.reason,
  });
  await Promise.all(
    recipientIds.map((recipientId) => postTelegramDirectMessage(recipientId, message)),
  );
}

export async function notifyEvaluationRejection(
  input: EvaluationRejectionNotificationInput,
): Promise<void> {
  if (!isTelegramBotConfigured()) {
    return;
  }
  try {
    await sendEvaluationRejectionNotification(input);
  } catch (error) {
    console.error("[telegram] failed to send evaluation rejection notification", {
      candidateId: input.candidateId,
      error,
      kind: input.kind,
      organizationId: input.organizationId,
    });
  }
}
