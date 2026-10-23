import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewAuditLog } from "@arc/db-schema/schema";
import { recordCandidateActivity } from "../utils/candidate-activity";

const actionLabels = {
  offer_ssc_completed: "完成确认",
  offer_ssc_confirmation_cancelled: "取消本次确认",
  offer_ssc_confirmation_opened: "打开二次确认",
  offer_ssc_preboarding_date_confirmed: "预入职时间确认",
  offer_ssc_received: "接收确认",
  offer_ssc_screenshot_uploaded: "上传审批截图",
  offer_ssc_upload_requested: "选择上传截图",
} as const;

type InteractionAction = Exclude<
  keyof typeof actionLabels,
  "offer_ssc_received" | "offer_ssc_completed" | "offer_ssc_preboarding_date_confirmed"
>;

interface OfferLocator {
  id: string;
  organizationId: string;
  interviewRecordId: string;
  sscRevision?: number | null;
}

interface TelegramOperator {
  responsibilityId: string;
  sscName: string;
  sscTelegram: string;
  telegramChatId: string;
}

export interface OfferSscActivity {
  action: string;
  label: string;
  operator: string;
  occurredAt: string;
}

export function describeOfferSscOperator(operator: TelegramOperator | null | undefined) {
  return operator ? `${operator.sscName}（${operator.sscTelegram}）` : "SSC";
}

export async function loadOfferSscActivity(draft: OfferLocator): Promise<OfferSscActivity[]> {
  const rows = await db
    .select({
      action: interviewAuditLog.action,
      createdAt: interviewAuditLog.createdAt,
      detail: interviewAuditLog.detail,
    })
    .from(interviewAuditLog)
    .where(
      and(
        eq(interviewAuditLog.organizationId, draft.organizationId),
        eq(interviewAuditLog.interviewRecordId, draft.interviewRecordId),
        inArray(interviewAuditLog.action, Object.keys(actionLabels)),
        sql`${interviewAuditLog.detail}->>'draftId' = ${draft.id}`,
        sql`${interviewAuditLog.detail}->>'revision' = ${String(draft.sscRevision ?? 1)}`,
      ),
    )
    .orderBy(desc(interviewAuditLog.createdAt), desc(interviewAuditLog.id))
    .limit(8);
  return rows.toReversed().flatMap((row) => {
    const label = actionLabels[row.action as keyof typeof actionLabels];
    const { sscName, sscTelegram } = row.detail;
    if (!label || typeof sscName !== "string" || typeof sscTelegram !== "string") {
      return [];
    }
    return [
      {
        action: row.action,
        label,
        occurredAt: row.createdAt.toISOString(),
        operator: `${sscName}（${sscTelegram}）`,
      },
    ];
  });
}

export async function recordOfferSscInteraction(
  context: {
    draft: OfferLocator & { version: number };
    telegramOperator?: TelegramOperator | null;
  },
  action: InteractionAction,
) {
  if (!context.telegramOperator) {
    return;
  }
  await recordCandidateActivity({
    action,
    detail: {
      ...context.telegramOperator,
      channel: "telegram",
      draftId: context.draft.id,
      revision: context.draft.sscRevision ?? 1,
      version: context.draft.version,
    },
    interviewRecordId: context.draft.interviewRecordId,
    operatorId: null,
    organizationId: context.draft.organizationId,
    source: "api",
  });
}
