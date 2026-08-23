import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import { resolveTelegramRecipientId } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import { jobDescription, studioInterview, user } from "@arc/db-schema/schema";
import { candidateOutcomeMeta, pipelineStageMeta } from "@arc/db-schema/studio-interviews";
import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";

interface CandidateStageNotificationInput {
  candidateName: string;
  fromOutcome: CandidateOutcome;
  fromStage: PipelineStage;
  jobDescriptionName: string | null;
  toOutcome: CandidateOutcome;
  toStage: PipelineStage;
}

export function buildCandidateStageNotification(input: CandidateStageNotificationInput): string {
  const lines = [
    "候选人状态更新",
    `候选人：${input.candidateName}`,
    input.jobDescriptionName ? `关联岗位：${input.jobDescriptionName}` : null,
    `招聘阶段：${pipelineStageMeta[input.fromStage].label} → ${pipelineStageMeta[input.toStage].label}`,
    input.fromOutcome === input.toOutcome
      ? `候选人状态：${candidateOutcomeMeta[input.toOutcome].label}`
      : `候选人状态：${candidateOutcomeMeta[input.fromOutcome].label} → ${candidateOutcomeMeta[input.toOutcome].label}`,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

interface CandidateStageChangeInput {
  candidateId: string;
  fromOutcome: CandidateOutcome;
  fromStage: PipelineStage;
  organizationId: string;
  toOutcome: CandidateOutcome;
  toStage: PipelineStage;
}

async function sendCandidateStageChange(input: CandidateStageChangeInput): Promise<void> {
  const [recipient] = await db
    .select({
      candidateName: studioInterview.candidateName,
      jobDescriptionName: jobDescription.name,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
    })
    .from(studioInterview)
    .leftJoin(user, eq(studioInterview.createdBy, user.id))
    .leftJoin(jobDescription, eq(studioInterview.jobDescriptionId, jobDescription.id))
    .where(
      and(
        eq(studioInterview.id, input.candidateId),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!recipient) {
    return;
  }

  const chatId = resolveTelegramRecipientId({
    boundUsername: recipient.telegramBoundUsername,
    chatId: recipient.telegramChatId,
    profileTelegram: recipient.telegram,
  });
  if (!chatId) {
    return;
  }

  const message = buildCandidateStageNotification({
    candidateName: recipient.candidateName,
    fromOutcome: input.fromOutcome,
    fromStage: input.fromStage,
    jobDescriptionName: recipient.jobDescriptionName,
    toOutcome: input.toOutcome,
    toStage: input.toStage,
  });
  await postTelegramDirectMessage(chatId, message);
}

export async function notifyCandidateStageChange(input: CandidateStageChangeInput): Promise<void> {
  if (!isTelegramBotConfigured()) {
    return;
  }
  try {
    await sendCandidateStageChange(input);
  } catch (error) {
    console.error("[telegram] failed to send candidate stage notification", {
      candidateId: input.candidateId,
      error,
      organizationId: input.organizationId,
    });
  }
}
