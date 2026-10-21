import { randomInt, randomUUID } from "node:crypto";
import type { ActionEvent, SlashCommandEvent, Message } from "chat";
import type * as S3 from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import {
  createOfferDraft,
  editOfferDraft,
  loadCurrentOfferSscState,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import {
  handleTelegramOfferAction,
  openTelegramOffer,
  handleTelegramOfferScreenshot,
} from "./offer-ssc";
import { buildOfferCandidatePreviewLink } from "@arc/ai-recruitment-copilot-backend/server/routes/public/routes/offer-candidates/access";
import { dispatchOfferSscNotifications } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-notification-outbox";
import { loadOfferCandidatePreview } from "@arc/ai-recruitment-copilot-backend/server/routes/public/routes/offer-candidates/dao";

const storage = vi.hoisted(() => ({ put: vi.fn(() => Promise.resolve()) }));
const transport = vi.hoisted(() => ({
  send: vi.fn<(chatId: string, message: unknown) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof S3>()),
  buildOfferApprovalAttachmentKey: (id: string, extension: string) =>
    Promise.resolve(`test-only/${id}.${extension}`),
  deleteObject: vi.fn(() => Promise.resolve()),
  putObjectBytes: storage.put,
}));
vi.mock("./offer-ssc-upload-prompt", () => ({
  postTelegramOfferScreenshotPrompt: async (
    thread: { post(text: string): Promise<{ id: string }> },
    text: string,
  ) => {
    const prompt = await thread.post(text);
    return prompt.id;
  },
}));
vi.mock("./bot", () => ({
  getTelegramBot: () => ({
    getAdapter: () => ({ editMessage: vi.fn(() => Promise.resolve()) }),
  }),
  isTelegramBotConfigured: () => true,
  postTelegramDirectMessage: transport.send,
}));

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

// Only Telegram transport/conversation state and screenshot object storage are replaced.
// Live SSC responsibility, verified chat binding, Offer services, audit/outbox writes
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
        await db.insert(telegramRecipientBinding).values({
          chatId: String(identity.chatId),
          username: identity.username,
        });
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
      await db.delete(telegramRecipientBinding).where(
        inArray(
          telegramRecipientBinding.chatId,
          Object.values(identities).map((identity) => String(identity.chatId)),
        ),
      );
      await db.delete(sscResponsibility).where(eq(sscResponsibility.organizationId, ORG));
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, ORG));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, ORG));
      await db.delete(department).where(eq(department.organizationId, ORG));
      await db.delete(organization).where(eq(organization.id, ORG));
      await db
        .delete(user)
        .where(inArray(user.id, [FIRST_SSC, RECEIVE_ONLY_SSC, CONFIRM_ONLY_SSC]));
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      storage.put.mockClear();
    });
    beforeEach(async () => {
      transport.send.mockReset().mockImplementation(() => Promise.resolve());
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
              sscName: identities.receiver.username,
              sscTelegram: `@${identities.receiver.username}`,
              telegramChatId: String(identities.receiver.chatId),
            }),
            operatorId: null,
            operatorRole: null,
            source: "api",
          }),
          expect.objectContaining({
            action: "offer_ssc_completed",
            detail: expect.objectContaining({
              channel: "telegram",
              internalApprovalConfirmed: true,
              sscName: identities.confirmer.username,
              sscTelegram: `@${identities.confirmer.username}`,
            }),
            operatorId: null,
            operatorRole: null,
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

    it("fans out A's receipt as second-confirmation cards to A and B, then broadcasts B's single completion", async () => {
      const draft = await newOffer();
      const receiver = fakeTelegram(identities.receiver);
      const confirmer = fakeTelegram(identities.confirmer);
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(2);
      transport.send.mockClear();
      await click(receiver, "osr", `${draft.id.replaceAll("-", "")}:1`);
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(2);
      const cards = new Map(transport.send.mock.calls.map((call) => [call[0], call[1]]));
      for (const telegram of [receiver, confirmer]) {
        const card = cards.get(String(telegram.identity.chatId));
        expect(findButton(card, "osf")).toBeTypeOf("string");
        expect(findButton(card, "osu")).toBeTypeOf("string");
        expect(findButton(card, "osr")).toBeUndefined();
        expect(JSON.stringify(card)).toContain(identities.receiver.username);
        await telegram.thread.post(card);
      }
      // B can confirm the broadcast card directly, without first receiving or opening a prompt.
      await click(confirmer, "osf", button(confirmer, "osf"), confirmer.sentIds.at(-1));
      expect(await systemState()).toMatchObject({ sscConfirmationStatus: "completed" });
      transport.send.mockClear();
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(2);
      for (const call of transport.send.mock.calls) {
        expect(JSON.stringify(call[1])).toContain(identities.confirmer.username);
        expect(JSON.stringify(call[1])).toContain("已完成确认");
        expect(findButton(call[1], "osf")).toBeUndefined();
        expect(findButton(call[1], "osc")).toBeUndefined();
      }
      await click(receiver, "osf", button(receiver, "osf"), receiver.sentIds.at(-1));
      const audits = await auditActions();
      expect(audits).toHaveLength(2);
      expect(audits.find((log) => log.action === "offer_ssc_completed")).toMatchObject({
        detail: {
          sscName: identities.confirmer.username,
          sscTelegram: `@${identities.confirmer.username}`,
        },
      });
      expect(await outboxEvents()).toEqual(["completed", "pending", "received"]);
    });

    it("records only one completion when two responsible SSCs confirm broadcast cards concurrently", async () => {
      const draft = await newOffer();
      const first = fakeTelegram(identities.receiver);
      const second = fakeTelegram(identities.confirmer);
      const value = `${draft.id.replaceAll("-", "")}:1`;
      await click(first, "osr", value);
      await Promise.all([click(first, "osf", value), click(second, "osf", value)]);
      expect(await systemState()).toMatchObject({ sscConfirmationStatus: "completed" });
      const audits = await auditActions();
      const completions = audits.filter((log) => log.action === "offer_ssc_completed");
      expect(completions).toHaveLength(1);
      expect([identities.receiver.username, identities.confirmer.username]).toContain(
        completions[0].detail.sscName,
      );
      expect(await outboxEvents()).toEqual(["completed", "pending", "received"]);
    });

    it("allows a responsible TG to receive and complete without workspace operation permissions", async () => {
      const draft = await newOffer();
      const confirmer = fakeTelegram(identities.confirmer);
      const value = `${draft.id.replaceAll("-", "")}:1`;
      await click(confirmer, "osr", value);
      await click(confirmer, "osc", value);
      await click(confirmer, "osf", button(confirmer, "osf"), confirmer.sentIds.at(-1));
      expect(await systemState()).toMatchObject({ sscConfirmationStatus: "completed" });
      expect(await auditActions()).toHaveLength(2);
    });

    it("allows candidate preview, screenshot upload and completion without any system account", async () => {
      const draft = await newOffer();
      const identity = {
        ...identities.receiver,
        chatId: randomInt(10_000_000, 999_999_999_999),
        username: `ssc_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      };
      const responsibilityId = randomUUID();
      await db
        .insert(telegramRecipientBinding)
        .values({ chatId: String(identity.chatId), username: identity.username });
      await db.insert(sscResponsibility).values({
        centerName: "Assigned source",
        email: "",
        id: responsibilityId,
        organizationId: ORG,
        resumeSourceId: SOURCE,
        sscName: "外部 SSC 花名",
        telegram: `@${identity.username}`,
      });
      try {
        const telegram = fakeTelegram(identity);
        const value = `${draft.id.replaceAll("-", "")}:1`;
        const previewLink = buildOfferCandidatePreviewLink({
          candidateId: CANDIDATE,
          draftId: draft.id,
          organizationId: ORG,
          revision: 1,
          telegramActor: { telegramUserId: String(identity.chatId), username: identity.username },
        });
        const previewToken = new URL(previewLink ?? "").pathname.split("/").at(-1) ?? "";
        expect(await loadOfferCandidatePreview(previewToken)).toMatchObject({
          preview: { candidate: { name: "Telegram integration candidate" } },
        });
        await click(telegram, "osr", value);
        await click(telegram, "osc", value);
        await click(telegram, "osu", button(telegram, "osu"), telegram.sentIds.at(-1));
        const uploadPromptId = telegram.sentIds.at(-1);
        const screenshot = Buffer.from("ffd8ffd9", "hex");
        vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
        vi.stubGlobal(
          "fetch",
          vi
            .fn()
            .mockResolvedValueOnce(
              Response.json({
                ok: true,
                result: { file_path: "photos/proof.jpg", file_size: screenshot.length },
              }),
            )
            .mockResolvedValueOnce(new Response(screenshot)),
        );
        await handleTelegramOfferScreenshot(
          telegram.thread as unknown as Parameters<typeof handleTelegramOfferScreenshot>[0],
          {
            attachments: [],
            metadata: { edited: false },
            raw: {
              chat: { id: identity.chatId, type: "private" },
              from: { id: identity.chatId, username: identity.username },
              message_id: 999,
              photo: [{ file_id: "test-photo", file_size: screenshot.length }],
              reply_to_message: { message_id: uploadPromptId },
            },
            replyTo: { id: `${identity.chatId}:${uploadPromptId}` },
          } as unknown as Message,
        );
        expect(await systemState()).toMatchObject({ sscConfirmationStatus: "confirming" });
        expect(storage.put).not.toHaveBeenCalled();
        expect(JSON.stringify(telegram.post.mock.calls.at(-1))).toContain("审批截图已收到");
        await click(telegram, "osf", button(telegram, "osf"), telegram.sentIds.at(-1));
        expect(await systemState()).toMatchObject({ sscConfirmationStatus: "completed" });
        expect(storage.put).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ body: new Uint8Array(screenshot), contentType: "image/jpeg" }),
        );
        const saved = await db.query.studioOfferDraft.findFirst({ where: { id: draft.id } });
        expect(saved).toMatchObject({
          sscCompletedBy: null,
          sscCompletionAttachment: {
            filename: "approval-screenshot.jpg",
            revision: 1,
            size: screenshot.length,
          },
          sscReceivedBy: null,
        });
        expect(await loadOfferCandidatePreview(previewToken, true)).toMatchObject({
          preview: {
            offer: { sscConfirmationStatus: "completed" },
            timeline: expect.arrayContaining([
              expect.objectContaining({ actorName: "外部 SSC 花名", title: "SSC 已完成确认" }),
            ]),
          },
        });
        await db.delete(sscResponsibility).where(eq(sscResponsibility.id, responsibilityId));
        expect(await loadOfferCandidatePreview(previewToken)).toBeNull();
        expect(await auditActions()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              detail: expect.objectContaining({
                sscName: "外部 SSC 花名",
                sscTelegram: `@${identity.username}`,
                telegramChatId: String(identity.chatId),
              }),
              operatorId: null,
            }),
          ]),
        );
      } finally {
        await db.delete(sscResponsibility).where(eq(sscResponsibility.id, responsibilityId));
        await db
          .delete(telegramRecipientBinding)
          .where(eq(telegramRecipientBinding.username, identity.username));
      }
    });

    it("ignores multiple system accounts sharing the responsible TG", async () => {
      const draft = await newOffer();
      const duplicateId = randomUUID();
      const identity = identities.receiver;
      await db.insert(user).values({
        email: `${duplicateId}@example.test`,
        id: duplicateId,
        name: "Duplicate TG",
        telegram: `@${identity.username}`,
        telegramBoundUsername: identity.username,
        telegramChatId: String(identity.chatId),
      });
      try {
        const telegram = fakeTelegram(identity);
        await click(telegram, "osr", `${draft.id.replaceAll("-", "")}:1`);
        expect(await systemState()).toMatchObject({ sscConfirmationStatus: "confirming" });
        const audits = await auditActions();
        expect(audits[0]).toMatchObject({
          detail: { sscName: identity.username, sscTelegram: `@${identity.username}` },
          operatorId: null,
        });
      } finally {
        await db.delete(user).where(eq(user.id, duplicateId));
      }
    });

    it("denies a genuinely bound SSC when the candidate belongs to an unassigned source", async () => {
      const draft = await newOffer();
      const receiver = fakeTelegram(identities.receiver);
      await db
        .update(jobDescription)
        .set({ resumeSourceId: OTHER_SOURCE })
        .where(eq(jobDescription.id, JD));
      await click(receiver, "osr", `${draft.id.replaceAll("-", "")}:1`);
      expect(JSON.stringify(receiver.post.mock.calls)).toContain("SSC 负责");
      expect(await systemState()).toMatchObject({ id: draft.id, sscConfirmationStatus: "pending" });
      expect(await auditActions()).toHaveLength(0);
      expect(await outboxEvents()).toEqual(["pending"]);
      expect(receiver.adapter.editMessage).not.toHaveBeenCalled();
    });

    it("revokes a pending completion when the verified TG binding changes", async () => {
      const draft = await newOffer();
      const identity = identities.receiver;
      const telegram = fakeTelegram(identity);
      const value = `${draft.id.replaceAll("-", "")}:1`;
      await click(telegram, "osr", value);
      await click(telegram, "osc", value);
      const promptMessageId = telegram.sentIds.at(-1);
      await db
        .update(telegramRecipientBinding)
        .set({ chatId: String(randomInt(10_000_000, 999_999_999_999)) })
        .where(eq(telegramRecipientBinding.username, identity.username));
      try {
        await click(telegram, "osf", button(telegram, "osf"), promptMessageId);
        expect(await systemState()).toMatchObject({ sscConfirmationStatus: "confirming" });
        expect(await auditActions()).toHaveLength(1);
        expect(JSON.stringify(telegram.post.mock.calls.at(-1))).toContain("TG 绑定已变更");
      } finally {
        await db
          .update(telegramRecipientBinding)
          .set({ chatId: String(identity.chatId) })
          .where(eq(telegramRecipientBinding.username, identity.username));
      }
    });

    it("never revives an older Offer after a newer Offer is deleted", async () => {
      const draft = await newOffer();
      const telegram = fakeTelegram(identities.receiver);
      const value = `${draft.id.replaceAll("-", "")}:1`;
      await click(telegram, "osr", value);
      await click(telegram, "osc", value);
      const promptMessageId = telegram.sentIds.at(-1);
      const newer = await newOffer();
      await db
        .update(studioOfferDraft)
        .set({ status: "deleted" })
        .where(eq(studioOfferDraft.id, newer.id));
      await click(telegram, "osf", button(telegram, "osf"), promptMessageId);
      const audits = await auditActions();
      expect(audits.map((row) => row.action)).not.toContain("offer_ssc_completed");
      expect(JSON.stringify(telegram.post.mock.calls.at(-1))).toContain("已更新");
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
