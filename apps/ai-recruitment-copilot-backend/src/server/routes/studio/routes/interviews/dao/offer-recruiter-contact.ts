import { and, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, studioInterview, studioOfferDraft, user } from "@arc/db-schema/schema";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { candidatePrivateTelegramSchema } from "@arc/shared/offer-recruiter-contact";
import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import { computeWorkspacePermissionSnapshot } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-permission-snapshot";
import {
  buildResumeVisibilityCondition,
  resolveResumeVisibilityScope,
} from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { normalizeTelegramUsername } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import { recordCandidateActivityInTransaction } from "../utils/candidate-activity";
import { enqueueOfferSscNotification } from "./offer-ssc-notification-outbox";
import { OfferDraftError } from "./offer-drafts";

type Connection = Pick<Database, "select">;
interface TelegramActor {
  telegramUserId: string;
  username: string;
}
type ContactActor =
  | { actorUserId: string; telegramActor?: never }
  | { actorUserId?: never; telegramActor: TelegramActor };
interface Locator {
  organizationId: string;
  interviewRecordId: string;
  draftId: string;
}
type ContactInput = Locator & ContactActor;

async function loadCandidate(input: Locator, connection: Connection, lock = false) {
  const query = connection
    .select({
      candidateName: studioInterview.candidateName,
      createdBy: studioInterview.createdBy,
      pipelineStage: studioInterview.pipelineStage,
    })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.interviewRecordId),
        eq(studioInterview.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const [candidate] = await (lock ? query.for("update") : query);
  if (!candidate) {
    throw new OfferDraftError("候选人记录不存在。", 404);
  }
  return candidate;
}
async function loadDraft(input: Locator, connection: Connection, lock = false) {
  const query = connection
    .select()
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.id, input.draftId),
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
        eq(studioOfferDraft.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const [draft] = await (lock ? query.for("update") : query);
  if (!draft) {
    throw new OfferDraftError("Offer 不存在。", 404);
  }
  return draft;
}
async function latestDraftId(input: Locator, connection: Connection) {
  // Include tombstones: deleting a newer version must not reopen an older task.
  const [latest] = await connection
    .select({ id: studioOfferDraft.id })
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.organizationId, input.organizationId),
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  return latest?.id;
}
async function loadProfile(organizationId: string, userId: string | null, connection: Connection) {
  if (!userId) {
    return null;
  }
  const [profile] = await connection
    .select({
      banned: user.banned,
      membershipId: member.id,
      name: user.name,
      role: member.role,
      telegram: user.telegram,
      telegramBoundUsername: user.telegramBoundUsername,
      telegramChatId: user.telegramChatId,
      userId: user.id,
    })
    .from(user)
    .leftJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, organizationId)))
    .where(eq(user.id, userId))
    .limit(1);
  return profile ?? null;
}
type Candidate = Awaited<ReturnType<typeof loadCandidate>>;
type Draft = Awaited<ReturnType<typeof loadDraft>>;
type Profile = Awaited<ReturnType<typeof loadProfile>>;
function isActiveMember(
  profile: Profile,
): profile is NonNullable<Profile> & { role: string; membershipId: string } {
  return Boolean(profile?.membershipId && profile.role && profile.banned !== true);
}
function boundRecruiterUsername(profile: Profile) {
  if (
    !isActiveMember(profile) ||
    !profile.telegramChatId ||
    !/^[1-9]\d*$/u.test(profile.telegramChatId)
  ) {
    return null;
  }
  const username = normalizeTelegramUsername(profile.telegram);
  return username && username === normalizeTelegramUsername(profile.telegramBoundUsername)
    ? username
    : null;
}
function notificationIssue(candidate: Candidate, recruiter: Profile) {
  if (!candidate.createdBy || !recruiter) {
    return "未找到简历上传人，请由有权限的 ODC 或管理员在系统补充候选人私人 TG。";
  }
  if (!isActiveMember(recruiter)) {
    return "简历上传人已不在当前工作区或账号已停用，请由有权限的 ODC 或管理员在系统补充。";
  }
  if (!boundRecruiterUsername(recruiter)) {
    return "简历上传人尚未绑定可接收通知的 TG，请先绑定并关注机器人，或在系统补充。";
  }
  return null;
}
function currentTask(candidate: Candidate, draft: Draft, latestId: string | undefined) {
  return (
    candidate.pipelineStage !== "closed" &&
    draft.status === "draft" &&
    latestId === draft.id &&
    (!draft.expiresAt || draft.expiresAt.getTime() > Date.now())
  );
}
async function authorize(
  input: ContactInput,
  candidate: Candidate,
  recruiter: Profile,
  connection: Connection,
  write: boolean,
) {
  if (input.telegramActor) {
    if (input.actorUserId || !isActiveMember(recruiter)) {
      throw new OfferDraftError("当前 TG 无权处理此招聘资料补充。", 403);
    }
    const username = boundRecruiterUsername(recruiter);
    if (
      !username ||
      recruiter.telegramChatId !== input.telegramActor.telegramUserId ||
      username !== normalizeTelegramUsername(input.telegramActor.username)
    ) {
      throw new OfferDraftError("当前 TG 不是简历上传人已绑定的账号，或绑定已变更。", 403);
    }
    return { canWrite: true, profile: recruiter };
  }
  if (!input.actorUserId) {
    throw new OfferDraftError("没有权限补充此候选人的私人 TG。", 403);
  }
  const profile = await loadProfile(input.organizationId, input.actorUserId, connection);
  if (!isActiveMember(profile)) {
    throw new OfferDraftError("没有权限补充此候选人的私人 TG。", 403);
  }
  if (candidate.createdBy === profile.userId) {
    return { canWrite: true, profile };
  }
  const snapshot = await computeWorkspacePermissionSnapshot({
    memberRole: profile.role,
    organizationId: input.organizationId,
    userId: profile.userId,
  });
  const canWrite = hasPermissionInStatements(snapshot.statements, "offer", "update");
  if (!canWrite && (write || !hasPermissionInStatements(snapshot.statements, "offer", "read"))) {
    throw new OfferDraftError("没有权限补充此候选人的私人 TG。", 403);
  }
  const visibility = await resolveResumeVisibilityScope({
    currentRole: profile.role,
    organizationId: input.organizationId,
    userId: profile.userId,
  });
  const [visible] = await connection
    .select({ id: studioInterview.id })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.interviewRecordId),
        eq(studioInterview.organizationId, input.organizationId),
        buildResumeVisibilityCondition(visibility),
      ),
    )
    .limit(1);
  if (!visible) {
    throw new OfferDraftError("候选人记录不存在。", 404);
  }
  return { canWrite, profile };
}
function state(
  input: Locator,
  candidate: Candidate,
  draft: Draft,
  recruiter: Profile,
  canWrite: boolean,
  latestId: string | undefined,
): OfferRecruiterContactState {
  return {
    canConfirm:
      canWrite &&
      draft.recruiterConfirmationStatus === "pending" &&
      currentTask(candidate, draft, latestId),
    candidateName: candidate.candidateName,
    candidatePrivateTelegram: draft.confirmationInfo?.candidatePrivateTelegram ?? null,
    draftId: input.draftId,
    interviewRecordId: input.interviewRecordId,
    notificationIssue:
      draft.recruiterConfirmationStatus === "pending"
        ? notificationIssue(candidate, recruiter)
        : null,
    organizationId: input.organizationId,
    position: draft.position,
    recruiterName: recruiter?.name ?? null,
    revision: draft.sscRevision,
    status: draft.recruiterConfirmationStatus,
    version: draft.version,
  };
}
export async function loadOfferRecruiterContactContext(
  input: ContactInput,
): Promise<OfferRecruiterContactState> {
  const candidate = await loadCandidate(input, db);
  const draft = await loadDraft(input, db);
  const recruiter = await loadProfile(input.organizationId, candidate.createdBy, db);
  const access = await authorize(input, candidate, recruiter, db, false);
  return state(input, candidate, draft, recruiter, access.canWrite, await latestDraftId(input, db));
}
export async function loadCurrentOfferRecruiterContactContext(input: {
  organizationId: string;
  interviewRecordId: string;
  actorUserId: string;
}): Promise<OfferRecruiterContactState | null> {
  const locator = { ...input, draftId: "" };
  const candidate = await loadCandidate(locator, db);
  const recruiter = await loadProfile(input.organizationId, candidate.createdBy, db);
  const access = await authorize(locator, candidate, recruiter, db, false);
  const [draft] = await db
    .select()
    .from(studioOfferDraft)
    .where(
      and(
        eq(studioOfferDraft.organizationId, input.organizationId),
        eq(studioOfferDraft.interviewRecordId, input.interviewRecordId),
      ),
    )
    .orderBy(desc(studioOfferDraft.version))
    .limit(1);
  if (!draft || !draft.recruiterConfirmationStatus || !currentTask(candidate, draft, draft.id)) {
    return null;
  }
  return state(
    { ...locator, draftId: draft.id },
    candidate,
    draft,
    recruiter,
    access.canWrite,
    draft.id,
  );
}
export async function loadTelegramOfferRecruiterContactContext(input: {
  draftId: string;
  telegramActor: TelegramActor;
}): Promise<OfferRecruiterContactState> {
  const [draft] = await db
    .select({
      interviewRecordId: studioOfferDraft.interviewRecordId,
      organizationId: studioOfferDraft.organizationId,
    })
    .from(studioOfferDraft)
    .where(eq(studioOfferDraft.id, input.draftId))
    .limit(1);
  if (!draft) {
    throw new OfferDraftError("Offer 不存在。", 404);
  }
  return await loadOfferRecruiterContactContext({ ...draft, ...input });
}
export async function submitOfferRecruiterContact(
  input: ContactInput & {
    revision: number;
    candidatePrivateTelegram: string;
    source: "system" | "telegram";
  },
): Promise<OfferRecruiterContactState> {
  const parsed = candidatePrivateTelegramSchema.safeParse(input.candidatePrivateTelegram);
  if (!parsed.success) {
    throw new OfferDraftError("请填写有效的候选人私人 TG 用户名，例如 @candidate_name。", 400);
  }
  if ((input.telegramActor ? "telegram" : "system") !== input.source) {
    throw new OfferDraftError("招聘资料补充来源无效。", 400);
  }
  const result = await db.transaction(async (tx) => {
    const candidate = await loadCandidate(input, tx, true);
    const draft = await loadDraft(input, tx, true);
    const recruiter = await loadProfile(input.organizationId, candidate.createdBy, tx);
    const access = await authorize(input, candidate, recruiter, tx, true);
    const latestId = await latestDraftId(input, tx);
    if (
      !currentTask(candidate, draft, latestId) ||
      draft.sscRevision !== input.revision ||
      draft.recruiterConfirmationStatus === null
    ) {
      throw new OfferDraftError("Offer 已更新或当前不能补充，请重新打开最新版本。", 409);
    }
    if (draft.recruiterConfirmationStatus === "completed") {
      if (
        draft.confirmationInfo?.candidatePrivateTelegram?.toLowerCase() !==
        parsed.data.toLowerCase()
      ) {
        throw new OfferDraftError("本版候选人私人 TG 已确认，不能重复提交不同账号。", 409);
      }
      return state(input, candidate, draft, recruiter, access.canWrite, latestId);
    }
    const now = new Date();
    const [updated] = await tx
      .update(studioOfferDraft)
      .set({
        confirmationInfo: offerConfirmationDetailsSchema.parse({
          ...draft.confirmationInfo,
          candidatePrivateTelegram: parsed.data,
        }),
        recruiterConfirmationStatus: "completed",
        recruiterConfirmedAt: now,
        recruiterConfirmedBy: access.profile.userId,
        recruiterConfirmedSource: input.source,
        updatedAt: now,
      })
      .where(eq(studioOfferDraft.id, draft.id))
      .returning();
    if (!updated) {
      throw new Error("补充私人 TG 后查询失败");
    }
    await recordCandidateActivityInTransaction(tx, {
      action: "offer_recruiter_contact_confirmed",
      detail: {
        candidatePrivateTelegram: parsed.data,
        channel: input.source,
        draftId: draft.id,
        revision: draft.sscRevision,
        version: draft.version,
        ...(input.telegramActor ? { telegramChatId: input.telegramActor.telegramUserId } : {}),
      },
      interviewRecordId: input.interviewRecordId,
      operatorId: access.profile.userId,
      operatorRole: access.profile.role,
      organizationId: input.organizationId,
      source: input.source === "telegram" ? "api" : "manual",
    });
    await enqueueOfferSscNotification(tx, {
      draftId: draft.id,
      event: "pending",
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
      revision: draft.sscRevision,
    });
    return state(input, candidate, updated, recruiter, access.canWrite, latestId);
  });
  invalidateStudioInterviewCaches(input.organizationId);
  return result;
}
