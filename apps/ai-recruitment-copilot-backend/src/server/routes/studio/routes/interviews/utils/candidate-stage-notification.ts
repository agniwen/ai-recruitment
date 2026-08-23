import { and, eq, sql } from "drizzle-orm";
import { Actions, Card, Divider, Field, Fields, LinkButton } from "chat";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  isTelegramBotConfigured,
  postTelegramDirectMessage,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import {
  extractTelegramUsername,
  resolveTelegramRecipientId,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import {
  department,
  hiringUnit,
  jobDescription,
  member,
  organization,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import { candidateOutcomeMeta, pipelineStageMeta } from "@arc/db-schema/studio-interviews";
import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";

interface CandidateStageNotificationInput {
  candidateName: string;
  departmentName: string | null;
  detailUrl: string | null;
  fromOutcome: CandidateOutcome;
  fromStage: PipelineStage;
  hiringUnitName: string | null;
  jobDescriptionName: string | null;
  organizationName: string;
  toOutcome: CandidateOutcome;
  toStage: PipelineStage;
}

export function buildCandidateStageNotification(input: CandidateStageNotificationInput) {
  const outcome =
    input.fromOutcome === input.toOutcome
      ? candidateOutcomeMeta[input.toOutcome].label
      : `${candidateOutcomeMeta[input.fromOutcome].label} → ${candidateOutcomeMeta[input.toOutcome].label}`;
  const fields = Fields([
    Field({ label: "候选人", value: input.candidateName }),
    Field({ label: "岗位", value: input.jobDescriptionName ?? "未关联岗位" }),
    Field({ label: "部门", value: input.departmentName ?? "未关联部门" }),
    Field({ label: "招聘主体", value: input.organizationName }),
    Field({ label: "用人组织", value: input.hiringUnitName ?? "未分配用人组织" }),
    Field({
      label: "阶段变化",
      value: `${pipelineStageMeta[input.fromStage].label} → ${pipelineStageMeta[input.toStage].label}`,
    }),
    Field({ label: "候选人状态", value: outcome }),
  ]);

  return Card({
    children: input.detailUrl
      ? [
          fields,
          Divider(),
          Actions([LinkButton({ label: "查看候选人详情", url: input.detailUrl })]),
        ]
      : [fields],
    title: "📋 候选人状态更新",
  });
}

function buildCandidateDetailUrl(candidateId: string, organizationSlug: string): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/u, "")}/w/${encodeURIComponent(organizationSlug)}/studio/resumes/${encodeURIComponent(candidateId)}`;
}

interface CandidateStageChangeInput {
  candidateId: string;
  fromOutcome: CandidateOutcome;
  fromStage: PipelineStage;
  organizationId: string;
  toOutcome: CandidateOutcome;
  toStage: PipelineStage;
}

interface TelegramRecipientProfile {
  telegram: string | null;
  telegramBoundUsername: string | null;
  telegramChatId: string | null;
}

export function resolveCandidateStageNotificationRecipientIds(
  recipients: TelegramRecipientProfile[],
): string[] {
  return [
    ...new Set(
      recipients
        .map((recipient) =>
          resolveTelegramRecipientId({
            boundUsername: recipient.telegramBoundUsername,
            chatId: recipient.telegramChatId,
            profileTelegram: recipient.telegram,
          }),
        )
        .filter((chatId): chatId is string => chatId !== null),
    ),
  ];
}

async function findResumeContactRecipient(
  organizationId: string,
  resumeContact: string | null,
): Promise<TelegramRecipientProfile | null> {
  const username = extractTelegramUsername(resumeContact);
  if (!username) {
    return null;
  }

  const matches = await db
    .select({
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
    })
    .from(user)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, organizationId)))
    .where(eq(sql<string>`lower(trim(leading '@' from ${user.telegram}))`, username))
    .limit(2);

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

async function sendCandidateStageChange(input: CandidateStageChangeInput): Promise<void> {
  const [candidate] = await db
    .select({
      candidateName: studioInterview.candidateName,
      departmentName: department.name,
      hiringUnitName: hiringUnit.name,
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
    .leftJoin(department, eq(jobDescription.departmentId, department.id))
    .leftJoin(hiringUnit, eq(studioInterview.hiringUnitId, hiringUnit.id))
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

  const resumeContactRecipient = await findResumeContactRecipient(
    input.organizationId,
    candidate.resumeContact,
  );
  const recipientIds = resolveCandidateStageNotificationRecipientIds([
    candidate,
    ...(resumeContactRecipient ? [resumeContactRecipient] : []),
  ]);
  if (recipientIds.length === 0) {
    return;
  }

  const message = buildCandidateStageNotification({
    candidateName: candidate.candidateName,
    departmentName: candidate.departmentName,
    detailUrl: buildCandidateDetailUrl(input.candidateId, candidate.organizationSlug),
    fromOutcome: input.fromOutcome,
    fromStage: input.fromStage,
    hiringUnitName: candidate.hiringUnitName,
    jobDescriptionName: candidate.jobDescriptionName,
    organizationName: candidate.organizationName,
    toOutcome: input.toOutcome,
    toStage: input.toStage,
  });
  await Promise.all(
    recipientIds.map((recipientId) => postTelegramDirectMessage(recipientId, message)),
  );
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
