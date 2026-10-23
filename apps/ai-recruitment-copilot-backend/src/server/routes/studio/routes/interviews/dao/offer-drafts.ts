// Offer 草稿 DAO。每次新建版本：
//   - version 取 MAX(version) + 1（同候选人下唯一索引保证 race-safe）
//   - 旧的非终态版本（draft / sent）自动 supersede
//   - 终态版本（accepted / declined / expired）不动
//
// Offer draft DAO. Each new version auto-increments and supersedes any
// existing non-terminal (draft/sent) drafts so HR's offer history stays
// linear without manual cleanup.
/* oxlint-disable max-lines -- versioned Offer mutations and shared SSC authorization use one lifecycle boundary */

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { isEqual } from "lodash-es";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { deleteObject } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import {
  studioHumanInterviewRound,
  studioInterview,
  studioInterviewSchedule,
  studioOfferDraft,
  member,
  user,
} from "@arc/db-schema/schema";
import { computeWorkspacePermissionSnapshot } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-permission-snapshot";
import {
  buildResumeVisibilityCondition,
  resolveResumeVisibilityScope,
} from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { recordCandidateActivityInTransaction } from "../utils/candidate-activity";
import type {
  OfferDraftInput,
  OfferDraftStatus,
  PipelineStage,
} from "@arc/db-schema/studio-interviews";
import type { OfferDraftRecord, OfferSscState } from "@arc/shared/studio-pipeline-stages";
import {
  getHumanInterviewOfferReadinessError,
  loadHumanInterviewRoundReadiness,
} from "./human-interview-rounds";
import { notifyCandidateStageChange } from "../utils/candidate-stage-notification";
import { enqueueOfferSscNotification } from "./offer-ssc-notification-outbox";
import { listSourceSscNotificationRecipients } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/ssc-notification-recipients";
import { normalizeTelegramUsername } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { offerPreboardingDateSchema } from "@arc/shared/offer-preboarding";
import { loadOfferCompletionInfo, loadOfferCompletionPreview } from "./offer-completion-info";

export type { OfferDraftRecord };

// 非终态状态：新建版本时会被 supersede。
// Non-terminal statuses that get superseded when a new version is created.
const SUPERSEDABLE_STATUSES = new Set<OfferDraftStatus>(["draft", "sent"]);

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// 日期字段 patch helper：input 传新值就用新值，否则退回 existing 的 ISO 字符串再转回 Date。
// Patch-merge helper for nullable Date columns: input wins; existing reused if absent.
function resolveDateField(next: string | null | undefined, current: string | null): Date | null {
  if (next) {
    return new Date(next);
  }
  return current ? new Date(current) : null;
}

function toRecord(row: typeof studioOfferDraft.$inferSelect): OfferDraftRecord {
  return {
    approvalAttachment: row.approvalAttachment
      ? {
          filename: row.approvalAttachment.filename,
          mediaType: row.approvalAttachment.mediaType,
          size: row.approvalAttachment.size,
        }
      : null,
    baseSalary: row.baseSalary,
    bonus: row.bonus,
    candidateCounter: row.candidateCounter,
    completionInfo: row.completionInfo ?? null,
    confirmationInfo: row.confirmationInfo ?? null,
    createdAt: serializeDate(row.createdAt) ?? new Date().toISOString(),
    currency: row.currency,
    equity: row.equity,
    expiresAt: serializeDate(row.expiresAt),
    id: row.id,
    interviewRecordId: row.interviewRecordId,
    joiningDate: serializeDate(row.joiningDate),
    notes: row.notes,
    organizationId: row.organizationId,
    position: row.position,
    preboardingDate: row.preboardingDate ?? null,
    recruiterConfirmationStatus: row.recruiterConfirmationStatus,
    recruiterConfirmedAt: serializeDate(row.recruiterConfirmedAt),
    recruiterConfirmedBy: row.recruiterConfirmedBy,
    recruiterConfirmedSource: row.recruiterConfirmedSource,
    responseAt: serializeDate(row.responseAt),
    sentAt: serializeDate(row.sentAt),
    sscCompletedAt: serializeDate(row.sscCompletedAt),
    sscCompletedBy: row.sscCompletedBy,
    sscCompletionAttachment:
      row.sscCompletionAttachment?.revision === row.sscRevision
        ? {
            filename: row.sscCompletionAttachment.filename,
            mediaType: row.sscCompletionAttachment.mediaType,
            revision: row.sscCompletionAttachment.revision,
            size: row.sscCompletionAttachment.size,
          }
        : null,
    sscConfirmationStatus: row.sscConfirmationStatus,
    sscReceivedAt: serializeDate(row.sscReceivedAt),
    sscReceivedBy: row.sscReceivedBy,
    sscRevision: row.sscRevision,
    status: row.status,
    updatedAt: serializeDate(row.updatedAt) ?? new Date().toISOString(),
    version: row.version,
  };
}

async function toReadRecord(row: typeof studioOfferDraft.$inferSelect): Promise<OfferDraftRecord> {
  const record = toRecord(row);
  const date = offerPreboardingDateSchema.nullable().safeParse(row.preboardingDate);
  if (
    record.completionInfo ||
    (row.sscConfirmationStatus !== "pending" && row.sscConfirmationStatus !== "confirming") ||
    row.status !== "draft" ||
    row.recruiterConfirmationStatus === "pending" ||
    !date.success ||
    (row.expiresAt && row.expiresAt.getTime() <= Date.now())
  ) {
    return record;
  }
  const [candidate] = await db
    .select({ pipelineStage: studioInterview.pipelineStage })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, row.interviewRecordId),
        eq(studioInterview.organizationId, row.organizationId),
      ),
    )
    .limit(1);
  if (!candidate || candidate.pipelineStage === "closed") {
    return record;
  }
  // Include newer deleted versions so a tombstone cannot revive a legacy draft.
  const [latest] = await db
    .select({ id: studioOfferDraft.id })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.interviewRecordId, row.interviewRecordId),
        eq(studioOfferDraft.organizationId, row.organizationId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  if (latest?.id !== row.id) {
    return record;
  }
  // Show recruitment and entry details from the first SSC handoff without
  // changing the date, approval, audit trail or any stored snapshot.
  return {
    ...record,
    completionInfo: await loadOfferCompletionPreview(
      {
        confirmationInfo: row.confirmationInfo,
        interviewRecordId: row.interviewRecordId,
        organizationId: row.organizationId,
        preboardingDate: date.data,
      },
      db,
    ),
  };
}

export class OfferDraftError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "OfferDraftError";
    this.status = status;
  }
}

type OfferTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockCandidateForOffer(
  tx: OfferTransaction,
  interviewRecordId: string,
  organizationId: string,
) {
  const [candidate] = await tx
    .select({ pipelineStage: studioInterview.pipelineStage })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, interviewRecordId),
        eq(studioInterview.organizationId, organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!candidate) {
    throw new OfferDraftError("候选人记录不存在。", 404);
  }
  return candidate;
}

async function lockDraftCandidate(tx: OfferTransaction, draftId: string, organizationId: string) {
  const [locator] = await tx
    .select({ interviewRecordId: studioOfferDraft.interviewRecordId })
    .from(studioOfferDraft)
    .where(
      and(eq(studioOfferDraft.id, draftId), eq(studioOfferDraft.organizationId, organizationId)),
    )
    .limit(1);
  if (!locator) {
    throw new OfferDraftError("Offer 草稿不存在", 404);
  }
  return await lockCandidateForOffer(tx, locator.interviewRecordId, organizationId);
}

function resetSscConfirmation(row: typeof studioOfferDraft.$inferSelect) {
  return row.sscConfirmationStatus === null
    ? {}
    : {
        completionInfo: null,
        preboardingDate: null,
        sscCompletedAt: null,
        sscCompletedBy: null,
        sscCompletionAttachment: null,
        sscConfirmationStatus: "pending" as const,
        sscReceivedAt: null,
        sscReceivedBy: null,
        sscRevision: row.sscRevision + 1,
      };
}

async function loadAuthorizedOfferCandidateContext(input: {
  actorUserId: string;
  organizationId: string;
  interviewRecordId: string;
}) {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.actorUserId),
        eq(user.banned, false),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new OfferDraftError("没有权限访问此 Offer。", 403);
  }
  const snapshot = await computeWorkspacePermissionSnapshot({
    memberRole: membership.role,
    organizationId: input.organizationId,
    userId: input.actorUserId,
  });
  if (!hasPermissionInStatements(snapshot.statements, "offer", "read")) {
    throw new OfferDraftError("没有权限查看 Offer。", 403);
  }
  const visibility = await resolveResumeVisibilityScope({
    currentRole: membership.role,
    organizationId: input.organizationId,
    userId: input.actorUserId,
  });
  const [candidate] = await db
    .select({
      candidateName: studioInterview.candidateName,
      pipelineStage: studioInterview.pipelineStage,
    })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.interviewRecordId),
        eq(studioInterview.organizationId, input.organizationId),
        buildResumeVisibilityCondition(visibility),
      ),
    )
    .limit(1);
  if (!candidate) {
    throw new OfferDraftError("候选人记录不存在。", 404);
  }
  return {
    actorRole: membership.role,
    canConfirm: hasPermissionInStatements(snapshot.statements, "offer", "confirm"),
    canReceive: hasPermissionInStatements(snapshot.statements, "offer", "receive"),
    candidateName: candidate.candidateName,
    pipelineStage: candidate.pipelineStage,
  };
}

export interface OfferSscTelegramActor {
  telegramUserId: string;
  username: string;
}

export type OfferSscAccess =
  | { actorUserId: string; telegramActor?: never }
  | { actorUserId?: never; telegramActor: OfferSscTelegramActor };

async function assertCurrentTelegramOffer(
  draft: Pick<
    typeof studioOfferDraft.$inferSelect,
    "id" | "organizationId" | "interviewRecordId" | "expiresAt"
  >,
  connection: Pick<typeof db, "select"> = db,
) {
  const [latest] = await connection
    .select({ id: studioOfferDraft.id })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.organizationId, draft.organizationId),
        eq(studioOfferDraft.interviewRecordId, draft.interviewRecordId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  if (latest?.id !== draft.id || (draft.expiresAt && draft.expiresAt.getTime() <= Date.now())) {
    throw new OfferDraftError("Offer 已更新或已过期，请重新打开最新 Offer。", 409);
  }
}

export async function loadAuthorizedOfferSscContext(
  input: OfferSscAccess & {
    draftId: string;
    organizationId?: string;
    interviewRecordId?: string;
  },
) {
  const [draft] = await db
    .select()
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.id, input.draftId),
        input.organizationId
          ? eq(studioOfferDraft.organizationId, input.organizationId)
          : undefined,
        input.interviewRecordId
          ? eq(studioOfferDraft.interviewRecordId, input.interviewRecordId)
          : undefined,
      ),
    )
    .limit(1);
  if (!draft) {
    throw new OfferDraftError("Offer 不存在。", 404);
  }
  if (input.telegramActor) {
    const username = normalizeTelegramUsername(input.telegramActor.username);
    const recipients = await listSourceSscNotificationRecipients({
      interviewRecordId: draft.interviewRecordId,
      organizationId: draft.organizationId,
    });
    const responsible = recipients.find(
      (recipient) =>
        recipient.chatId === input.telegramActor.telegramUserId && recipient.username === username,
    );
    if (!responsible) {
      throw new OfferDraftError(
        "当前 TG 不在此候选人所属组织的 SSC 负责关系中，或 TG 绑定已变更。",
        403,
      );
    }
    await assertCurrentTelegramOffer(draft);
    return {
      actorRole: null,
      canConfirm: draft.recruiterConfirmationStatus !== "pending",
      canReceive: draft.recruiterConfirmationStatus !== "pending",
      candidateName: responsible.candidateName,
      draft: await toReadRecord(draft),
      pipelineStage: responsible.pipelineStage,
      telegramOperator: {
        responsibilityId: responsible.responsibilityId,
        sscName: responsible.sscName,
        sscTelegram: `@${responsible.username}`,
        telegramChatId: responsible.chatId,
      },
    };
  }
  const context = await loadAuthorizedOfferCandidateContext({
    actorUserId: input.actorUserId,
    interviewRecordId: draft.interviewRecordId,
    organizationId: draft.organizationId,
  });
  return {
    ...context,
    canConfirm: context.canConfirm && draft.recruiterConfirmationStatus !== "pending",
    canReceive: context.canReceive && draft.recruiterConfirmationStatus !== "pending",
    draft: await toReadRecord(draft),
    telegramOperator: null,
  };
}

export async function loadCurrentOfferSscState(input: {
  actorUserId: string;
  organizationId: string;
  interviewRecordId: string;
}): Promise<OfferSscState | null> {
  await loadAuthorizedOfferCandidateContext(input);
  const [state] = await db
    .select({
      id: studioOfferDraft.id,
      recruiterConfirmationStatus: studioOfferDraft.recruiterConfirmationStatus,
      sscConfirmationStatus: studioOfferDraft.sscConfirmationStatus,
      status: studioOfferDraft.status,
      version: studioOfferDraft.version,
    })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
        eq(studioOfferDraft.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  return state ?? null;
}

export interface OfferSscActionInput {
  draftId: string;
  interviewRecordId: string;
  organizationId: string;
  revision: number;
  actor: { id: string; role: string | null } | OfferSscTelegramActor;
  source?: "manual" | "telegram";
}

export interface OfferSscCompletionInput extends OfferSscActionInput {
  expectedPreboardingDate?: string;
  internalApprovalConfirmed: true;
  completionAttachment?: NonNullable<
    (typeof studioOfferDraft.$inferInsert)["sscCompletionAttachment"]
  >;
}

function assertSscTransitionCurrent(
  candidate: { pipelineStage: PipelineStage },
  existing: typeof studioOfferDraft.$inferSelect,
  revision: number,
) {
  if (existing.recruiterConfirmationStatus === "pending") {
    throw new OfferDraftError("请先由招聘人员补充并确认候选人私人 TG。", 409);
  }
  if (
    candidate.pipelineStage === "closed" ||
    existing.status !== "draft" ||
    existing.sscConfirmationStatus === null
  ) {
    throw new OfferDraftError("该 Offer 当前不能进行 SSC 确认。", 409);
  }
  if (existing.sscRevision !== revision) {
    throw new OfferDraftError("Offer 内容已更新，请刷新后重新确认。", 409);
  }
}

function assertExpectedPreboardingDate(
  existing: typeof studioOfferDraft.$inferSelect,
  expectedPreboardingDate: string | undefined,
  action: "receive" | "preboarding" | "complete",
) {
  if (
    action === "complete" &&
    expectedPreboardingDate !== undefined &&
    expectedPreboardingDate !== existing.preboardingDate
  ) {
    throw new OfferDraftError("预入职日期已更新，请重新打开确认卡片后再完成确认。", 409);
  }
}

async function saveOfferPreboardingDate(
  tx: OfferTransaction,
  existing: typeof studioOfferDraft.$inferSelect,
  input: OfferSscActionInput & { preboardingDate?: string },
  context: Awaited<ReturnType<typeof loadAuthorizedOfferSscContext>>,
) {
  const preboardingDate = offerPreboardingDateSchema.safeParse(input.preboardingDate);
  if (!preboardingDate.success) {
    throw new OfferDraftError(preboardingDate.error.issues[0].message, 400);
  }
  if (
    existing.preboardingDate === preboardingDate.data &&
    existing.completionInfo?.preboardingDate === preboardingDate.data
  ) {
    return { changed: false, draft: toRecord(existing) };
  }
  // Preview recruitment and entry details together with the saved date. Final
  // confirmation reloads these sources before freezing its completed snapshot.
  const completionInfo = await loadOfferCompletionInfo(
    {
      confirmationInfo: existing.confirmationInfo,
      interviewRecordId: existing.interviewRecordId,
      organizationId: existing.organizationId,
      preboardingDate: preboardingDate.data,
    },
    tx,
  );
  const [updated] = await tx
    .update(studioOfferDraft)
    .set({ completionInfo, preboardingDate: preboardingDate.data, updatedAt: new Date() })
    .where(eq(studioOfferDraft.id, existing.id))
    .returning();
  if (!updated) {
    throw new Error("预入职日期保存后查询失败");
  }
  const channel = context.telegramOperator ? "telegram" : (input.source ?? "manual");
  await recordCandidateActivityInTransaction(tx, {
    action: "offer_ssc_preboarding_date_confirmed",
    detail: {
      ...context.telegramOperator,
      channel,
      draftId: existing.id,
      preboardingDate: preboardingDate.data,
      previousDate: existing.preboardingDate,
      revision: existing.sscRevision,
      version: existing.version,
    },
    interviewRecordId: input.interviewRecordId,
    operatorId: "id" in input.actor ? input.actor.id : null,
    operatorRole: context.actorRole,
    organizationId: input.organizationId,
    source: channel === "telegram" ? "api" : "manual",
  });
  return { changed: true, draft: toRecord(updated) };
}

async function loadSscCompletionSnapshot(
  tx: OfferTransaction,
  existing: typeof studioOfferDraft.$inferSelect,
  action: "receive" | "complete",
) {
  if (action !== "complete") {
    return null;
  }
  if (!existing.preboardingDate) {
    throw new OfferDraftError("请先完成预入职时间确认并录入预入职日期。", 409);
  }
  return await loadOfferCompletionInfo(
    {
      confirmationInfo: existing.confirmationInfo,
      interviewRecordId: existing.interviewRecordId,
      organizationId: existing.organizationId,
      preboardingDate: existing.preboardingDate,
    },
    tx,
  );
}

async function transitionOfferSscConfirmation(
  input: OfferSscActionInput &
    Partial<Pick<OfferSscCompletionInput, "completionAttachment" | "expectedPreboardingDate">> & {
      preboardingDate?: string;
    },
  action: "receive" | "preboarding" | "complete",
) {
  const context = await loadAuthorizedOfferSscContext({
    ...input,
    ...("telegramUserId" in input.actor
      ? { telegramActor: input.actor }
      : { actorUserId: input.actor.id }),
  });
  if (context.draft.recruiterConfirmationStatus === "pending") {
    throw new OfferDraftError("请先由招聘人员补充并确认候选人私人 TG。", 409);
  }
  if (!(action === "receive" ? context.canReceive : context.canConfirm)) {
    throw new OfferDraftError(
      action === "receive" ? "没有 SSC 接收确认权限。" : "没有 SSC 完成确认权限。",
      403,
    );
  }
  const operatorId = "id" in input.actor ? input.actor.id : null;
  const channel = context.telegramOperator ? "telegram" : (input.source ?? "manual");
  const source = channel === "telegram" ? "api" : "manual";
  const completionDetail =
    action === "complete"
      ? {
          hasApprovalScreenshot: Boolean(input.completionAttachment),
          internalApprovalConfirmed: true,
        }
      : {};
  const result = await db.transaction(async (tx) => {
    const candidate = await lockCandidateForOffer(
      tx,
      input.interviewRecordId,
      input.organizationId,
    );
    const [existing] = await tx
      .select()
      .from(studioOfferDraft)
      .where(
        and(
          eq(studioOfferDraft.id, input.draftId),
          eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
          eq(studioOfferDraft.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!existing) {
      throw new OfferDraftError("Offer 不存在。", 404);
    }
    if (context.telegramOperator || action === "preboarding") {
      await assertCurrentTelegramOffer(existing, tx);
    }
    assertSscTransitionCurrent(candidate, existing, input.revision);
    assertExpectedPreboardingDate(existing, input.expectedPreboardingDate, action);
    if (
      existing.sscConfirmationStatus === "completed" ||
      (action === "receive" && existing.sscConfirmationStatus === "confirming")
    ) {
      if (action === "preboarding" && existing.preboardingDate !== input.preboardingDate) {
        throw new OfferDraftError("Offer 已完成确认，不能修改预入职日期。", 409);
      }
      return { changed: false, draft: toRecord(existing) };
    }
    if (action !== "receive" && existing.sscConfirmationStatus !== "confirming") {
      throw new OfferDraftError("请先由 SSC 接收确认。", 409);
    }
    if (action === "preboarding") {
      return await saveOfferPreboardingDate(tx, existing, input, context);
    }
    const completionInfo = await loadSscCompletionSnapshot(tx, existing, action);
    const now = new Date();
    const [updated] = await tx
      .update(studioOfferDraft)
      .set(
        action === "receive"
          ? {
              sscConfirmationStatus: "confirming",
              sscReceivedAt: now,
              sscReceivedBy: operatorId,
              updatedAt: now,
            }
          : {
              completionInfo,
              sscCompletedAt: now,
              sscCompletedBy: operatorId,
              sscCompletionAttachment: input.completionAttachment ?? null,
              sscConfirmationStatus: "completed",
              updatedAt: now,
            },
      )
      .where(eq(studioOfferDraft.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error("SSC 确认后查询失败");
    }
    await recordCandidateActivityInTransaction(tx, {
      action: action === "receive" ? "offer_ssc_received" : "offer_ssc_completed",
      detail: {
        ...completionDetail,
        ...context.telegramOperator,
        channel,
        draftId: existing.id,
        revision: existing.sscRevision,
        version: existing.version,
      },
      interviewRecordId: input.interviewRecordId,
      operatorId,
      operatorRole: context.actorRole,
      organizationId: input.organizationId,
      source,
    });
    await enqueueOfferSscNotification(tx, {
      draftId: updated.id,
      event: action === "receive" ? "received" : "completed",
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
      revision: updated.sscRevision,
    });
    return { changed: true, draft: toRecord(updated) };
  });
  if (result.changed) {
    invalidateStudioInterviewCaches(input.organizationId);
  }
  return result;
}

export async function receiveOfferSscConfirmation(
  input: OfferSscActionInput,
): Promise<OfferDraftRecord> {
  const result = await transitionOfferSscConfirmation(input, "receive");
  return result.draft;
}

export async function confirmOfferPreboardingDate(
  input: OfferSscActionInput & { preboardingDate: string },
): Promise<OfferDraftRecord> {
  const parsed = offerPreboardingDateSchema.safeParse(input.preboardingDate);
  if (!parsed.success) {
    throw new OfferDraftError(parsed.error.issues[0].message, 400);
  }
  const result = await transitionOfferSscConfirmation(
    { ...input, preboardingDate: parsed.data },
    "preboarding",
  );
  return result.draft;
}

export async function completeOfferSscConfirmationWithEvidence(input: OfferSscCompletionInput) {
  if (input.internalApprovalConfirmed !== true) {
    throw new OfferDraftError("请确认已经完成内部审批。", 400);
  }
  if (input.completionAttachment && input.completionAttachment.revision !== input.revision) {
    throw new OfferDraftError("审批截图与当前 Offer 修订不一致，请重新上传。", 409);
  }
  const result = await transitionOfferSscConfirmation(input, "complete");
  return {
    attachmentUsed: result.changed && Boolean(input.completionAttachment),
    draft: result.draft,
  };
}

export async function completeOfferSscConfirmation(
  input: OfferSscCompletionInput,
): Promise<OfferDraftRecord> {
  const result = await completeOfferSscConfirmationWithEvidence(input);
  return result.draft;
}

export async function loadOfferSscCompletionAttachment(input: {
  actorUserId: string;
  draftId: string;
  interviewRecordId: string;
  organizationId: string;
}) {
  const context = await loadAuthorizedOfferSscContext(input);
  if (["deleted", "superseded"].includes(context.draft.status)) {
    return null;
  }
  const [row] = await db
    .select({
      attachment: studioOfferDraft.sscCompletionAttachment,
      revision: studioOfferDraft.sscRevision,
    })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.id, input.draftId),
        eq(studioOfferDraft.organizationId, input.organizationId),
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
        eq(studioOfferDraft.sscConfirmationStatus, "completed"),
      ),
    )
    .limit(1);
  return row?.attachment && row.attachment.revision === row.revision ? row.attachment : null;
}

async function cleanupCompletionAttachment(storageKey: string | null | undefined) {
  if (!storageKey) {
    return;
  }
  try {
    await deleteObject(storageKey);
  } catch (error) {
    console.error("Failed to delete obsolete SSC completion screenshot", error);
  }
}

// 列出候选人所有 offer 版本，按 version desc（最新在前）。
// List all offer versions for a candidate, newest first.
export async function listOfferDrafts(
  interviewRecordId: string,
  organizationId: string,
): Promise<OfferDraftRecord[]> {
  const rows = await db
    .select()
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.interviewRecordId, interviewRecordId),
        eq(studioOfferDraft.organizationId, organizationId),
        ne(studioOfferDraft.status, "deleted"),
      ),
    )
    .orderBy(desc(studioOfferDraft.version));
  return await Promise.all(rows.map(toReadRecord));
}

// 加载单条详情，校验组织归属。
// Load a single draft, scoped to org.
export async function loadDraftById(
  draftId: string,
  organizationId: string,
): Promise<OfferDraftRecord | null> {
  const [row] = await db
    .select()
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.id, draftId),
        eq(studioOfferDraft.organizationId, organizationId),
        ne(studioOfferDraft.status, "deleted"),
      ),
    )
    .limit(1);
  return row ? await toReadRecord(row) : null;
}

export async function loadOfferApprovalAttachment(
  draftId: string,
  interviewRecordId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ approvalAttachment: studioOfferDraft.approvalAttachment })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.id, draftId),
        eq(studioOfferDraft.interviewRecordId, interviewRecordId),
        eq(studioOfferDraft.organizationId, organizationId),
        ne(studioOfferDraft.status, "deleted"),
      ),
    )
    .limit(1);
  return row?.approvalAttachment ?? null;
}

export async function removeOfferApprovalAttachment(
  draftId: string,
  interviewRecordId: string,
  organizationId: string,
) {
  const result = await db.transaction(async (tx) => {
    const candidate = await lockCandidateForOffer(tx, interviewRecordId, organizationId);
    const [row] = await tx
      .select()
      .from(studioOfferDraft)
      .where(
        and(
          eq(studioOfferDraft.id, draftId),
          eq(studioOfferDraft.interviewRecordId, interviewRecordId),
          eq(studioOfferDraft.organizationId, organizationId),
          ne(studioOfferDraft.status, "deleted"),
        ),
      )
      .for("update")
      .limit(1);
    if (!row?.approvalAttachment) {
      return null;
    }
    if (
      row.sscConfirmationStatus !== null &&
      (row.status !== "draft" || candidate.pipelineStage === "closed")
    ) {
      throw new OfferDraftError("已发送的 Offer 不能修改审核附件，请新建版本。", 400);
    }
    await tx
      .update(studioOfferDraft)
      .set({ ...resetSscConfirmation(row), approvalAttachment: null, updatedAt: new Date() })
      .where(eq(studioOfferDraft.id, draftId));
    if (row.sscConfirmationStatus !== null) {
      await enqueueOfferSscNotification(tx, {
        draftId,
        event: row.recruiterConfirmationStatus === "pending" ? "recruiter" : "pending",
        interviewRecordId,
        organizationId,
        revision: row.sscRevision + 1,
      });
    }
    return {
      attachment: row.approvalAttachment,
      obsoleteCompletionKey: row.sscCompletionAttachment?.storageKey,
    };
  });
  await cleanupCompletionAttachment(result?.obsoleteCompletionKey);
  return result?.attachment ?? null;
}

export interface CreateDraftOptions {
  approvalAttachment?: (typeof studioOfferDraft.$inferInsert)["approvalAttachment"];
  actorId?: string | null;
  actorRole?: string | null;
  interviewRecordId: string;
  organizationId: string;
  input: OfferDraftInput;
  // 是否直接发出（默认 false，进 draft 状态）。
  // Whether to send immediately; defaults to draft.
  sendImmediately?: boolean;
}

// 新建版本：MAX(version)+1，旧的非终态版自动 supersede。
// FOR UPDATE 锁确保并发 race 下 version 不冲突（搭配 unique index 兜底）。
//
// Create new version: max(version)+1; supersede any non-terminal predecessors.
// FOR UPDATE lock + unique index protect against concurrent inserts.
export async function createOfferDraft({
  approvalAttachment = null,
  actorId = null,
  actorRole = null,
  interviewRecordId,
  organizationId,
  input,
  sendImmediately,
}: CreateDraftOptions): Promise<OfferDraftRecord> {
  if (sendImmediately) {
    throw new OfferDraftError("新建 Offer 必须先完成 SSC 确认，不能立即发送。", 400);
  }
  const id = crypto.randomUUID();
  const now = new Date();

  return await db.transaction(async (tx) => {
    const candidate = await lockCandidateForOffer(tx, interviewRecordId, organizationId);
    if (candidate.pipelineStage === "closed") {
      throw new OfferDraftError("已结案候选人不能创建 Offer。", 400);
    }
    // 锁同候选人下的所有 draft，串行化新建版本流程。
    // Lock all drafts for this candidate to serialize version creation.
    const existing = await tx
      .select({
        confirmationInfo: studioOfferDraft.confirmationInfo,
        id: studioOfferDraft.id,
        status: studioOfferDraft.status,
        version: studioOfferDraft.version,
      })
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.interviewRecordId, interviewRecordId))
      .orderBy(desc(studioOfferDraft.version))
      .for("update");

    const [latestExisting] = existing;
    const nextVersion = latestExisting ? latestExisting.version + 1 : 1;
    const previousTelegram = latestExisting?.confirmationInfo?.candidatePrivateTelegram;
    const confirmationInfo =
      input.confirmationInfo?.candidatePrivateTelegram === undefined && previousTelegram
        ? offerConfirmationDetailsSchema.parse({
            ...input.confirmationInfo,
            candidatePrivateTelegram: previousTelegram,
          })
        : (input.confirmationInfo ?? null);

    // Supersede 所有未结的旧版本。
    // Supersede all non-terminal predecessors.
    const toSupersede = existing
      .filter((row) => SUPERSEDABLE_STATUSES.has(row.status))
      .map((row) => row.id);
    if (toSupersede.length > 0) {
      await tx
        .update(studioOfferDraft)
        .set({ status: "superseded", updatedAt: now })
        .where(inArray(studioOfferDraft.id, toSupersede));
    }

    await tx.insert(studioOfferDraft).values({
      approvalAttachment,
      baseSalary: input.baseSalary,
      bonus: input.bonus ?? null,
      confirmationInfo,
      createdAt: now,
      createdBy: actorId,
      createdByRole: actorRole,
      currency: input.currency ?? "CNY",
      equity: input.equity ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      id,
      interviewRecordId,
      joiningDate: input.joiningDate ? new Date(input.joiningDate) : null,
      notes: input.notes ?? null,
      organizationId,
      position: input.position,
      recruiterConfirmationStatus: "pending",
      sscConfirmationStatus: "pending",
      sscRevision: 1,
      status: "draft",
      updatedAt: now,
      version: nextVersion,
    });

    const [created] = await tx
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, id))
      .limit(1);
    if (!created) {
      throw new Error("创建后查询失败");
    }
    await enqueueOfferSscNotification(tx, {
      draftId: created.id,
      event: "recruiter",
      interviewRecordId,
      organizationId,
      revision: created.sscRevision,
    });
    return toRecord(created);
  });
}

// 编辑草稿：仅 status='draft' 时允许；其他状态用 /respond 或 /cancel 走专属路径。
// Edit a draft; only allowed in 'draft' status.
export interface EditDraftOptions {
  draftId: string;
  organizationId: string;
  input: Partial<OfferDraftInput>;
  approvalAttachment?: (typeof studioOfferDraft.$inferInsert)["approvalAttachment"];
}

function resolveEditedConfirmationInfo(
  existing: typeof studioOfferDraft.$inferSelect,
  next: OfferDraftInput["confirmationInfo"],
) {
  if (next === undefined) {
    return existing.confirmationInfo;
  }
  if (existing.recruiterConfirmationStatus !== "completed") {
    return next;
  }
  const confirmedTelegram = existing.confirmationInfo?.candidatePrivateTelegram ?? null;
  if (
    next?.candidatePrivateTelegram !== undefined &&
    next.candidatePrivateTelegram?.toLowerCase() !== confirmedTelegram?.toLowerCase()
  ) {
    throw new OfferDraftError("候选人私人 TG 已确认，如需更换请新建 Offer 版本后重新确认。", 409);
  }
  return offerConfirmationDetailsSchema.parse({
    ...next,
    candidatePrivateTelegram: confirmedTelegram,
  });
}

function buildOfferEditPatch(
  existing: typeof studioOfferDraft.$inferSelect,
  input: Partial<OfferDraftInput>,
  approvalAttachment: EditDraftOptions["approvalAttachment"],
  now: Date,
) {
  return {
    ...(approvalAttachment !== undefined && { approvalAttachment }),
    baseSalary: input.baseSalary ?? existing.baseSalary,
    bonus: input.bonus ?? existing.bonus,
    confirmationInfo: resolveEditedConfirmationInfo(existing, input.confirmationInfo),
    currency: input.currency ?? existing.currency,
    equity: input.equity ?? existing.equity,
    expiresAt: resolveDateField(input.expiresAt, serializeDate(existing.expiresAt)),
    joiningDate: resolveDateField(input.joiningDate, serializeDate(existing.joiningDate)),
    notes: input.notes ?? existing.notes,
    position: input.position ?? existing.position,
    updatedAt: now,
  };
}

function hasOfferEditChanges(
  existing: typeof studioOfferDraft.$inferSelect,
  patch: ReturnType<typeof buildOfferEditPatch>,
) {
  return Object.entries(patch).some(([key, value]) => {
    if (key === "updatedAt") {
      return false;
    }
    const previous = existing[key as keyof typeof existing];
    return value instanceof Date || previous instanceof Date
      ? (value instanceof Date ? value.getTime() : value) !==
          (previous instanceof Date ? previous.getTime() : previous)
      : !isEqual(value, previous);
  });
}

export async function editOfferDraftWithAttachment({
  draftId,
  organizationId,
  input,
  approvalAttachment,
}: EditDraftOptions): Promise<{
  updated: OfferDraftRecord;
  previousAttachment: (typeof studioOfferDraft.$inferSelect)["approvalAttachment"];
}> {
  const now = new Date();

  // 事务 + FOR UPDATE：read existing → 校验 status → merge → write。
  // 防止两名 HR 同时编辑同一份草稿造成 (input ?? existing) merge 字段相互覆盖。
  // Transaction + FOR UPDATE: serialize read → validate → merge → write so
  // concurrent edits to the same draft can't lose each other's writes.
  const result = await db.transaction(async (tx) => {
    const candidate = await lockDraftCandidate(tx, draftId, organizationId);
    const [existing] = await tx
      .select()
      .from(studioOfferDraft)
      .where(
        and(
          eq(studioOfferDraft.id, draftId),
          eq(studioOfferDraft.organizationId, organizationId),
          ne(studioOfferDraft.status, "deleted"),
        ),
      )
      .for("update")
      .limit(1);
    if (!existing) {
      throw new OfferDraftError("Offer 草稿不存在", 404);
    }
    if (existing.status !== "draft") {
      throw new OfferDraftError("只有草稿状态的 Offer 可以编辑", 400);
    }
    if (existing.sscConfirmationStatus !== null && candidate.pipelineStage === "closed") {
      throw new OfferDraftError("已结案候选人的 Offer 不能编辑。", 400);
    }
    const patch = buildOfferEditPatch(existing, input, approvalAttachment, now);
    const changed = hasOfferEditChanges(existing, patch);
    const [updated] = await tx
      .update(studioOfferDraft)
      .set({ ...patch, ...(changed ? resetSscConfirmation(existing) : {}) })
      .where(eq(studioOfferDraft.id, draftId))
      .returning();
    if (!updated) {
      throw new Error("更新后查询失败");
    }
    if (changed && existing.sscConfirmationStatus !== null) {
      await enqueueOfferSscNotification(tx, {
        draftId: updated.id,
        event: updated.recruiterConfirmationStatus === "pending" ? "recruiter" : "pending",
        interviewRecordId: updated.interviewRecordId,
        organizationId,
        revision: updated.sscRevision,
      });
    }
    return {
      obsoleteCompletionAttachment: changed ? existing.sscCompletionAttachment : null,
      previousAttachment: approvalAttachment === undefined ? null : existing.approvalAttachment,
      updated: toRecord(updated),
    };
  });
  await cleanupCompletionAttachment(result.obsoleteCompletionAttachment?.storageKey);
  return { previousAttachment: result.previousAttachment, updated: result.updated };
}

export async function editOfferDraft(options: EditDraftOptions): Promise<OfferDraftRecord> {
  const { updated } = await editOfferDraftWithAttachment(options);
  return updated;
}

// draft → sent：发出 Offer。
// Mark draft as sent.
export async function sendOfferDraft(
  draftId: string,
  organizationId: string,
  actor?: { id: string | null; role: string | null },
): Promise<OfferDraftRecord> {
  return await db.transaction(async (tx) => {
    const candidate = await lockDraftCandidate(tx, draftId, organizationId);
    const [existing] = await tx
      .select()
      .from(studioOfferDraft)
      .where(
        and(eq(studioOfferDraft.id, draftId), eq(studioOfferDraft.organizationId, organizationId)),
      )
      .for("update")
      .limit(1);
    if (!existing || existing.status === "deleted") {
      throw new OfferDraftError("Offer 草稿不存在", 404);
    }
    if (existing.status !== "draft") {
      throw new OfferDraftError("只有草稿状态的 Offer 可以发出", 400);
    }
    if (existing.recruiterConfirmationStatus === "pending") {
      throw new OfferDraftError("请先由招聘人员补充并确认候选人私人 TG。", 409);
    }
    if (
      existing.sscConfirmationStatus !== null &&
      (existing.sscConfirmationStatus !== "completed" || candidate.pipelineStage === "closed")
    ) {
      throw new OfferDraftError(
        "Offer 必须先完成 SSC 确认，且候选人流程仍在进行中，才能发送。",
        409,
      );
    }
    const now = new Date();
    const [updated] = await tx
      .update(studioOfferDraft)
      .set({
        sentAt: now,
        sentBy: actor?.id ?? null,
        sentByRole: actor?.role ?? null,
        status: "sent",
        updatedAt: now,
      })
      .where(eq(studioOfferDraft.id, draftId))
      .returning();
    if (!updated) {
      throw new Error("发出后查询失败");
    }
    return toRecord(updated);
  });
}

// sent → accepted/declined/counter（counter 不改变 status，只记 candidateCounter；
// HR 后续通过新建版本响应议价）。
// Record candidate response. counter doesn't terminate the draft — it just
// records the counter text; HR creates a new version to respond.
export interface RespondOfferOptions {
  draftId: string;
  organizationId: string;
  response: "accepted" | "declined" | "counter";
  candidateCounter?: string | null;
}

export async function respondOfferDraft({
  draftId,
  organizationId,
  response,
  candidateCounter,
}: RespondOfferOptions): Promise<OfferDraftRecord> {
  const existing = await loadDraftById(draftId, organizationId);
  if (!existing) {
    throw new OfferDraftError("Offer 草稿不存在", 404);
  }
  if (existing.status !== "sent") {
    throw new OfferDraftError("只有已发送的 Offer 可以记录响应", 400);
  }
  const now = new Date();
  // counter 保持 status='sent'，让 HR 看到这版还在协商；accepted/declined 终态化。
  // counter keeps status='sent' so HR sees it's still under negotiation;
  // accepted/declined move to terminal status.
  const nextStatus: OfferDraftStatus = response === "counter" ? "sent" : response;
  await db
    .update(studioOfferDraft)
    .set({
      candidateCounter: candidateCounter ?? existing.candidateCounter,
      responseAt: now,
      status: nextStatus,
      updatedAt: now,
    })
    .where(eq(studioOfferDraft.id, draftId));
  const updated = await loadDraftById(draftId, organizationId);
  if (!updated) {
    throw new Error("响应后查询失败");
  }
  return updated;
}

// Sent Offer 撤回：HR 主动把已发出的 Offer 置为 expired（语义：撤回 / 过期 / 不再有效）。
// 没用 declined 是因为 declined 是候选人拒绝的语义。
// 撤回后如果是「最后一份非终态 offer」，把候选人 pipelineStage 回退到合适的前置阶段，
// 避免 UI 出现「在 offer 阶段但没有可见 offer」的虚状态。
//
// HR-side withdrawal of a sent offer; uses 'expired' instead of 'declined' to
// keep semantics distinct (declined = candidate said no). When the cancelled
// draft was the last active one, roll the candidate back to a sensible
// pre-offer stage so the UI doesn't show "offer stage with no offers".
export async function cancelOfferDraft(
  draftId: string,
  organizationId: string,
): Promise<OfferDraftRecord> {
  const now = new Date();

  const stageChange = await db.transaction(async (tx) => {
    await lockDraftCandidate(tx, draftId, organizationId);
    // 1. 锁住草稿行 + 校验。
    // 1. Lock the draft row + validate.
    const [existing] = await tx
      .select()
      .from(studioOfferDraft)
      .where(
        and(
          eq(studioOfferDraft.id, draftId),
          eq(studioOfferDraft.organizationId, organizationId),
          ne(studioOfferDraft.status, "deleted"),
        ),
      )
      .for("update")
      .limit(1);
    if (!existing) {
      throw new OfferDraftError("Offer 草稿不存在", 404);
    }
    if (existing.status !== "sent" && existing.status !== "draft") {
      throw new OfferDraftError("已结状态的 Offer 不可撤回", 400);
    }

    // 2. 把这份草稿改成 expired。
    // 2. Mark the cancelled draft as expired.
    await tx
      .update(studioOfferDraft)
      .set({ status: "expired", updatedAt: now })
      .where(eq(studioOfferDraft.id, draftId));

    // 3. 同候选人是否还有其它非终态 (draft/sent) 草稿？还有则不回退。
    // 3. Any other non-terminal drafts for the same candidate? If so, no rollback.
    const remaining = await tx
      .select({ id: studioOfferDraft.id })
      .from(studioOfferDraft)
      .where(
        and(
          eq(studioOfferDraft.interviewRecordId, existing.interviewRecordId),
          eq(studioOfferDraft.organizationId, organizationId),
          inArray(studioOfferDraft.status, ["draft", "sent"]),
        ),
      )
      .limit(1);
    if (remaining.length > 0) {
      return null;
    }

    // 4. 派生回退目标阶段：有非取消的真人复面 → human_interview；否则有 AI schedule → ai_interview；
    //    都没有就回 screening。Closed / 非 offer 阶段直接不动（守卫在下方 UPDATE 的 WHERE）。
    // 4. Derive rollback target: human rounds win, else AI schedules, else screening.
    const [humanRound] = await tx
      .select({ id: studioHumanInterviewRound.id })
      .from(studioHumanInterviewRound)
      .where(
        and(
          eq(studioHumanInterviewRound.interviewRecordId, existing.interviewRecordId),
          eq(studioHumanInterviewRound.organizationId, organizationId),
          ne(studioHumanInterviewRound.status, "cancelled"),
        ),
      )
      .limit(1);
    let targetStage: PipelineStage;
    if (humanRound) {
      targetStage = "human_interview";
    } else {
      const [schedule] = await tx
        .select({ id: studioInterviewSchedule.id })
        .from(studioInterviewSchedule)
        .where(
          and(
            eq(studioInterviewSchedule.interviewRecordId, existing.interviewRecordId),
            eq(studioInterviewSchedule.organizationId, organizationId),
          ),
        )
        .limit(1);
      targetStage = schedule ? "ai_interview" : "screening";
    }

    // 5. 只在 (pipelineStage='offer', outcome='in_pipeline') 时回退。
    //    其它阶段（closed / 已被人挪走）一律不动；WHERE 守卫让并发竞争变成 no-op。
    // 5. Roll back only when still in offer/in_pipeline. WHERE guard makes
    //    concurrent close (already past offer) a no-op rather than CHECK violation.
    const changed = await tx
      .update(studioInterview)
      .set({ pipelineStage: targetStage, updatedAt: now })
      .where(
        and(
          eq(studioInterview.id, existing.interviewRecordId),
          eq(studioInterview.organizationId, organizationId),
          eq(studioInterview.pipelineStage, "offer"),
          eq(studioInterview.outcome, "in_pipeline"),
        ),
      )
      .returning({ id: studioInterview.id });
    return changed.length > 0
      ? { candidateId: existing.interviewRecordId, toStage: targetStage }
      : null;
  });

  if (stageChange) {
    await notifyCandidateStageChange({
      candidateId: stageChange.candidateId,
      fromOutcome: "in_pipeline",
      fromStage: "offer",
      organizationId,
      toOutcome: "in_pipeline",
      toStage: stageChange.toStage,
    });
  }

  const updated = await loadDraftById(draftId, organizationId);
  if (!updated) {
    throw new Error("撤回后查询失败");
  }
  return updated;
}

// Logically delete one Offer version by moving it into the hidden `deleted`
// state. The row stays in storage and version numbers are never reused.
export async function deleteOfferDraft(
  draftId: string,
  organizationId: string,
): Promise<{ draft: OfferDraftRecord; previousStatus: OfferDraftStatus }> {
  return await db.transaction(async (tx) => {
    await lockDraftCandidate(tx, draftId, organizationId);
    const [existing] = await tx
      .select()
      .from(studioOfferDraft)
      .where(
        and(
          eq(studioOfferDraft.id, draftId),
          eq(studioOfferDraft.organizationId, organizationId),
          ne(studioOfferDraft.status, "deleted"),
        ),
      )
      .for("update")
      .limit(1);
    if (!existing) {
      throw new OfferDraftError("Offer 不存在", 404);
    }

    const [deleted] = await tx
      .update(studioOfferDraft)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(eq(studioOfferDraft.id, draftId))
      .returning();
    if (!deleted) {
      throw new Error("删除后查询失败");
    }
    return { draft: toRecord(deleted), previousStatus: existing.status };
  });
}

// 创建 Offer 时自动推进候选人 pipelineStage 到 offer。
// 仅在创建第一版（同候选人下没有任何 draft 行时之前的状态）触发，
// 避免每次新版都跳一次。守卫不从 closed / offer 推（offer 不动 / closed 阻拦）。
//
// Auto-advance to offer stage when the candidate's first draft is created.
// Won't move from offer/closed.
export async function maybeAdvanceToOffer(
  interviewRecordId: string,
  organizationId: string,
): Promise<boolean> {
  const drafts = await db
    .select({ id: studioOfferDraft.id })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.interviewRecordId, interviewRecordId),
        eq(studioOfferDraft.organizationId, organizationId),
        ne(studioOfferDraft.status, "deleted"),
      ),
    )
    .limit(2);
  if (drafts.length !== 1) {
    return false;
  }
  const [candidate] = await db
    .select({ pipelineStage: studioInterview.pipelineStage })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, interviewRecordId),
        eq(studioInterview.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (candidate?.pipelineStage === "human_interview") {
    const readiness = await loadHumanInterviewRoundReadiness(interviewRecordId, organizationId);
    if (getHumanInterviewOfferReadinessError(readiness)) {
      return false;
    }
  }
  // 同 maybeAdvanceToHumanInterview：把守卫推到 UPDATE 的 WHERE 上，避免与
  // 并发 close 之间的 TOCTOU 触发 DB CHECK 约束。
  // Mirrors maybeAdvanceToHumanInterview — guard via UPDATE's WHERE clause so
  // a concurrent close becomes a no-op instead of violating the CHECK.
  const updated = await db
    .update(studioInterview)
    .set({ pipelineStage: "offer", updatedAt: new Date() })
    .where(
      and(
        eq(studioInterview.id, interviewRecordId),
        eq(studioInterview.organizationId, organizationId),
        eq(studioInterview.pipelineStage, "human_interview"),
        eq(studioInterview.outcome, "in_pipeline"),
      ),
    )
    .returning({ id: studioInterview.id });
  return updated.length > 0;
}
