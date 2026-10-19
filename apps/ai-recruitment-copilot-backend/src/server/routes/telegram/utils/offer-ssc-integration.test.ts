import { randomInt, randomUUID } from "node:crypto";
import type { ActionEvent, SlashCommandEvent } from "chat";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  interviewAuditLog,
  jobDescription,
  member,
  organization,
  organizationRole,
  resumeSource,
  sscResponsibility,
  studioInterview,
  studioOfferDraft,
  studioOfferSscNotificationOutbox,
  user,
} from "@arc/db-schema/schema";
import {
  createOfferDraft,
  editOfferDraft,
  loadCurrentOfferSscState,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { handleTelegramOfferAction, openTelegramOffer } from "./offer-ssc";

const testDatabaseUrl = process.env.SSC_TELEGRAM_TEST_DATABASE_URL;

const ORG = `test_tg_offer_integration_${randomUUID()}`;
const CANDIDATE = randomUUID();
const FIRST_SSC = randomUUID();
const RECEIVE_ONLY_SSC = randomUUID();
const CONFIRM_ONLY_SSC = randomUUID();
const SOURCE = randomUUID();
const OTHER_SOURCE = randomUUID();
const DEPARTMENT = randomUUID();
const JD = randomUUID();
const identities = {
  confirmer: {
    chatId: randomInt(10_000_000, 999_999_999_999),
    role: "ssc-integration-confirm",
    userId: CONFIRM_ONLY_SSC,
    username: `ssc_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
  },
  receiver: {
    chatId: randomInt(10_000_000, 999_999_999_999),
    role: "ssc-integration-receive",
    userId: RECEIVE_ONLY_SSC,
    username: `ssc_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
  },
};
type Identity = (typeof identities)[keyof typeof identities];

// Only Telegram transport/conversation storage is replaced. Identity resolution,
// current workspace membership/visibility, Offer services, audit/outbox writes
// and the PostgreSQL completion-state advisory lock all execute for real.
function fakeTelegram(identity: Identity) {
  let state: Record<string, unknown> | null = null;
  let nextMessageId = 100;
  const sentIds: number[] = [];
  const post = vi.fn((_message: unknown) => {
    nextMessageId += 1;
    sentIds.push(nextMessageId);
    return Promise.resolve({ id: `${identity.chatId}:${nextMessageId}` });
  });
  const adapter = {
    editMessage: vi.fn((_threadId: string, _messageId: string, _card: unknown) =>
      Promise.resolve(),
    ),
  };
  const thread = {
    id: `telegram:${identity.chatId}`,
    post,
    setState(value: Record<string, unknown>) {
      state = value;
      return Promise.resolve();
    },
    get state() {
      return Promise.resolve(state);
    },
  };
  return { adapter, identity, post, sentIds, thread };
}
type FakeTelegram = ReturnType<typeof fakeTelegram>;

function findButton(value: unknown, actionId: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  if (item.id === actionId && typeof item.value === "string") {
    return item.value;
  }
  for (const child of Object.values(item)) {
    const found = findButton(child, actionId);
    if (found) {
      return found;
    }
  }
}

function button(telegram: FakeTelegram, actionId: string): string {
  const value = findButton(telegram.post.mock.calls, actionId);
  expect(value, `${actionId} button`).toBeTypeOf("string");
  if (!value) {
    throw new Error(`Missing ${actionId} button`);
  }
  return value;
}

async function openOffer(telegram: FakeTelegram, draftId: string) {
  await openTelegramOffer(
    {
      channel: { post: telegram.post },
      raw: {
        chat: { id: telegram.identity.chatId, type: "private" },
        from: { id: telegram.identity.chatId, username: telegram.identity.username },
      },
    } as unknown as SlashCommandEvent,
    draftId,
  );
}

async function click(telegram: FakeTelegram, actionId: string, value: string, messageId = 7) {
  await handleTelegramOfferAction({
    actionId,
    adapter: telegram.adapter,
    messageId: `${telegram.identity.chatId}:${messageId}`,
    raw: {
      from: { id: telegram.identity.chatId, username: telegram.identity.username },
      message: { chat: { id: telegram.identity.chatId, type: "private" }, message_id: messageId },
    },
    thread: telegram.thread,
    threadId: telegram.thread.id,
    // Supplied system identity must never override the bound numeric TG sender.
    user: { userId: "forged-owner" },
    value,
  } as unknown as ActionEvent);
}

async function systemState() {
  return await loadCurrentOfferSscState({
    actorUserId: FIRST_SSC,
    interviewRecordId: CANDIDATE,
    organizationId: ORG,
  });
}

async function auditActions() {
  return await db.select().from(interviewAuditLog).where(eq(interviewAuditLog.organizationId, ORG));
}

async function outboxEvents() {
  const rows = await db
    .select({ event: studioOfferSscNotificationOutbox.event })
    .from(studioOfferSscNotificationOutbox)
    .where(eq(studioOfferSscNotificationOutbox.organizationId, ORG));
  return rows.map((row) => row.event).toSorted();
}

describe.skipIf(!testDatabaseUrl || testDatabaseUrl !== process.env.DATABASE_URL)(
  "Telegram callbacks and system Offer state integration",
  () => {
    let fixtureStarted = false;
    beforeAll(async () => {
      // Fixture records are opt-in and confined to the isolated test database.
      if (
        new URL(testDatabaseUrl ?? "postgres://invalid/unknown").pathname !==
        "/ai_recruitment_ssc_test"
      ) {
        throw new Error("Telegram Offer integration tests require /ai_recruitment_ssc_test");
      }
      fixtureStarted = true;
      await db.insert(organization).values({ id: ORG, name: "TG Offer integration", slug: ORG });
      await db
        .insert(user)
        .values({ email: `${FIRST_SSC}@example.com`, id: FIRST_SSC, name: "Offer creator" });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: ORG, role: "owner", userId: FIRST_SSC });
      await db.insert(resumeSource).values([
        { id: SOURCE, name: "Assigned source", organizationId: ORG },
        { id: OTHER_SOURCE, name: "Unassigned source", organizationId: ORG },
      ]);
      await db
        .insert(department)
        .values({ id: DEPARTMENT, name: "Integration department", organizationId: ORG });
      await db.insert(jobDescription).values({
        departmentId: DEPARTMENT,
        id: JD,
        name: "Integration role",
        organizationId: ORG,
        prompt: "Test only",
        resumeSourceId: SOURCE,
      });
      await db.insert(studioInterview).values({
        candidateName: "Telegram integration candidate",
        createdBy: FIRST_SSC,
        id: CANDIDATE,
        jobDescriptionId: JD,
        organizationId: ORG,
        pipelineStage: "offer",
      });
      for (const identity of Object.values(identities)) {
        await db.insert(organizationRole).values({
          id: randomUUID(),
          isSsc: true,
          name: identity.role,
          organizationId: ORG,
          permission: JSON.stringify({
            offer: ["read", identity.userId === RECEIVE_ONLY_SSC ? "receive" : "confirm"],
          }),
          role: identity.role,
        });
        await db.insert(user).values({
          email: `${identity.userId}@example.com`,
          id: identity.userId,
          name: identity.username,
          telegram: `@${identity.username}`,
          telegramBoundUsername: identity.username.toLowerCase(),
          telegramChatId: String(identity.chatId),
        });
        await db.insert(member).values({
          id: randomUUID(),
          organizationId: ORG,
          role: identity.role,
          userId: identity.userId,
        });
        await db.insert(sscResponsibility).values({
          centerName: "Assigned source",
          email: `${identity.userId}@example.com`,
          id: randomUUID(),
          organizationId: ORG,
          resumeSourceId: SOURCE,
          sscName: identity.username,
          telegram: `@${identity.username}`,
          workspaceRole: identity.role,
        });
      }
    });
    afterAll(async () => {
      if (!fixtureStarted) {
        return;
      }
      await db.delete(sscResponsibility).where(eq(sscResponsibility.organizationId, ORG));
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, ORG));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, ORG));
      await db.delete(department).where(eq(department.organizationId, ORG));
      await db.delete(organization).where(eq(organization.id, ORG));
      await db
        .delete(user)
        .where(inArray(user.id, [FIRST_SSC, RECEIVE_ONLY_SSC, CONFIRM_ONLY_SSC]));
    });
    beforeEach(async () => {
      await db.delete(interviewAuditLog).where(eq(interviewAuditLog.organizationId, ORG));
      await db.delete(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG));
      await db
        .update(studioInterview)
        .set({
          createdBy: FIRST_SSC,
          outcome: "in_pipeline",
          pipelineStage: "offer",
        })
        .where(eq(studioInterview.id, CANDIDATE));
      await db
        .update(jobDescription)
        .set({ resumeSourceId: SOURCE })
        .where(eq(jobDescription.id, JD));
    });

    async function newOffer() {
      return await createOfferDraft({
        actorId: FIRST_SSC,
        actorRole: "owner",
        input: { baseSalary: 30_000, currency: "CNY", position: "Integration role" },
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
      });
    }

    it("receives and explicitly completes the same Offer through real bound actors and services", async () => {
      const draft = await newOffer();
      const receiver = fakeTelegram(identities.receiver);
      const confirmer = fakeTelegram(identities.confirmer);
      expect(await systemState()).toMatchObject({ id: draft.id, sscConfirmationStatus: "pending" });

      await openOffer(receiver, draft.id);
      const receiveValue = button(receiver, "osr");
      const receiveCardMessageId = receiver.sentIds.at(-1);
      await click(receiver, "osr", receiveValue, receiveCardMessageId);
      expect(await systemState()).toMatchObject({
        id: draft.id,
        sscConfirmationStatus: "confirming",
      });
      expect(receiver.adapter.editMessage).toHaveBeenCalledWith(
        receiver.thread.id,
        `${receiver.identity.chatId}:${receiveCardMessageId}`,
        expect.anything(),
      );
      expect(JSON.stringify(receiver.adapter.editMessage.mock.calls.at(-1)?.[2])).toContain(
        "确认中",
      );
      expect(
        findButton(receiver.adapter.editMessage.mock.calls.at(-1)?.[2], "osr"),
      ).toBeUndefined();
      expect(await outboxEvents()).toEqual(["pending", "received"]);

      await openOffer(confirmer, draft.id);
      const originalCardMessageId = confirmer.sentIds.at(-1);
      await click(confirmer, "osc", button(confirmer, "osc"), originalCardMessageId);
      expect(await systemState()).toMatchObject({
        id: draft.id,
        sscConfirmationStatus: "confirming",
      });
      expect(await auditActions()).toHaveLength(1);
      expect(await outboxEvents()).toEqual(["pending", "received"]);
      expect(JSON.stringify(confirmer.post.mock.calls)).toContain("内部审批");

      const finalValue = button(confirmer, "osf");
      const promptMessageId = confirmer.sentIds.at(-1);
      expect(promptMessageId).toBeTypeOf("number");
      await click(confirmer, "osf", finalValue, promptMessageId);
      expect(await systemState()).toMatchObject({
        id: draft.id,
        sscConfirmationStatus: "completed",
      });
      for (const messageId of [originalCardMessageId, promptMessageId]) {
        expect(confirmer.adapter.editMessage).toHaveBeenCalledWith(
          confirmer.thread.id,
          `${confirmer.identity.chatId}:${messageId}`,
          expect.anything(),
        );
      }
      expect(JSON.stringify(confirmer.adapter.editMessage.mock.calls.at(-1)?.[2])).toContain(
        "已完成确认",
      );
      expect(
        findButton(confirmer.adapter.editMessage.mock.calls.at(-1)?.[2], "osc"),
      ).toBeUndefined();
      expect(
        findButton(confirmer.adapter.editMessage.mock.calls.at(-1)?.[2], "osf"),
      ).toBeUndefined();
      const audits = await auditActions();
      expect(audits).toHaveLength(2);
      expect(audits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "offer_ssc_received",
            detail: expect.objectContaining({
              channel: "telegram",
              draftId: draft.id,
              revision: 1,
            }),
            operatorId: RECEIVE_ONLY_SSC,
            operatorRole: identities.receiver.role,
            source: "api",
          }),
          expect.objectContaining({
            action: "offer_ssc_completed",
            detail: expect.objectContaining({
              channel: "telegram",
              internalApprovalConfirmed: true,
            }),
            operatorId: CONFIRM_ONLY_SSC,
            operatorRole: identities.confirmer.role,
            source: "api",
          }),
        ]),
      );
      expect(await outboxEvents()).toEqual(["completed", "pending", "received"]);

      // Old receive/final buttons cannot regress state or duplicate side effects.
      await click(receiver, "osr", receiveValue);
      await click(confirmer, "osf", finalValue, promptMessageId);
      expect(await systemState()).toMatchObject({
        id: draft.id,
        sscConfirmationStatus: "completed",
      });
      expect(await auditActions()).toHaveLength(2);
      expect(await outboxEvents()).toEqual(["completed", "pending", "received"]);
    });

    it("denies receiving to a bound member who has completion permission only", async () => {
      const draft = await newOffer();
      const confirmer = fakeTelegram(identities.confirmer);
      await click(confirmer, "osr", `${draft.id.replaceAll("-", "")}:1`);
      expect(JSON.stringify(confirmer.post.mock.calls)).toContain("没有 SSC 接收确认权限");
      expect(await systemState()).toMatchObject({ id: draft.id, sscConfirmationStatus: "pending" });
      expect(await auditActions()).toHaveLength(0);
      expect(await outboxEvents()).toEqual(["pending"]);
      expect(confirmer.adapter.editMessage).not.toHaveBeenCalled();
    });

    it("denies completing to a bound member who has receive permission only", async () => {
      const draft = await newOffer();
      const receiver = fakeTelegram(identities.receiver);
      const value = `${draft.id.replaceAll("-", "")}:1`;
      await click(receiver, "osr", value);
      await click(receiver, "osc", value);
      expect(JSON.stringify(receiver.post.mock.calls)).toContain("没有 SSC 完成确认权限");
      expect(await systemState()).toMatchObject({
        id: draft.id,
        sscConfirmationStatus: "confirming",
      });
      expect(await auditActions()).toHaveLength(1);
      expect(await outboxEvents()).toEqual(["pending", "received"]);
    });

    it("denies a genuinely bound SSC when the candidate belongs to an unassigned source", async () => {
      const draft = await newOffer();
      const receiver = fakeTelegram(identities.receiver);
      await db
        .update(jobDescription)
        .set({ resumeSourceId: OTHER_SOURCE })
        .where(eq(jobDescription.id, JD));
      await click(receiver, "osr", `${draft.id.replaceAll("-", "")}:1`);
      expect(JSON.stringify(receiver.post.mock.calls)).toContain("候选人记录不存在");
      expect(await systemState()).toMatchObject({ id: draft.id, sscConfirmationStatus: "pending" });
      expect(await auditActions()).toHaveLength(0);
      expect(await outboxEvents()).toEqual(["pending"]);
      expect(receiver.adapter.editMessage).not.toHaveBeenCalled();
    });

    it("rejects an old completion prompt after edited Offer terms reset confirmation", async () => {
      const draft = await newOffer();
      const receiver = fakeTelegram(identities.receiver);
      const confirmer = fakeTelegram(identities.confirmer);
      const value = `${draft.id.replaceAll("-", "")}:1`;
      await click(receiver, "osr", value);
      await click(confirmer, "osc", value);
      const finalValue = button(confirmer, "osf");
      const promptMessageId = confirmer.sentIds.at(-1);
      await editOfferDraft({
        draftId: draft.id,
        input: { baseSalary: 35_000 },
        organizationId: ORG,
      });
      await click(confirmer, "osf", finalValue, promptMessageId);
      expect(JSON.stringify(confirmer.post.mock.calls)).toContain("已更新");
      expect(await systemState()).toMatchObject({ id: draft.id, sscConfirmationStatus: "pending" });
      const audits = await auditActions();
      expect(audits.map((row) => row.action)).not.toContain("offer_ssc_completed");
      expect(await outboxEvents()).toEqual(["pending", "pending", "received"]);
    });
  },
);
