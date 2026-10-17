import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { organization, studioInterview, studioOfferDraft } from "@arc/db-schema/schema";
import type * as TelegramBot from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot";
import {
  dispatchOfferSscNotifications,
  enqueueOfferSscNotification,
} from "./offer-ssc-notification-outbox";
import type { OfferSscNotificationInput } from "./offer-ssc-notification-outbox";

const mocks = vi.hoisted(() => ({ post: vi.fn(), targets: vi.fn() }));
vi.mock("../utils/offer-ssc-notification", () => ({
  getOfferSscNotificationTargets: mocks.targets,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot",
  async (importOriginal) => ({
    ...(await importOriginal<typeof TelegramBot>()),
    postTelegramDirectMessage: mocks.post,
  }),
);

const fixtureOrganizations: string[] = [];
const TARGET_A = { chatId: "111", message: "SSC notification A", userId: "ssc-a" };
const TARGET_B = { chatId: "222", message: "SSC notification B", userId: "ssc-b" };
const databaseUrl = process.env.SSC_OUTBOX_TEST_DATABASE_URL;

async function fixture(): Promise<OfferSscNotificationInput> {
  const organizationId = `test_ssc_outbox_${randomUUID()}`;
  const interviewRecordId = randomUUID();
  const draftId = randomUUID();
  fixtureOrganizations.push(organizationId);
  await db
    .insert(organization)
    .values({ id: organizationId, name: organizationId, slug: organizationId });
  await db.insert(studioInterview).values({
    candidateName: "Outbox fixture",
    id: interviewRecordId,
    organizationId,
    pipelineStage: "offer",
  });
  await db.insert(studioOfferDraft).values({
    baseSalary: 30_000,
    id: draftId,
    interviewRecordId,
    organizationId,
    position: "Engineer",
    sscConfirmationStatus: "pending",
    version: 1,
  });
  return { draftId, event: "pending", interviewRecordId, organizationId, revision: 1 };
}

function enqueue(input: OfferSscNotificationInput) {
  return db.transaction((tx) => enqueueOfferSscNotification(tx, input));
}

async function jobs(input: OfferSscNotificationInput) {
  return await db.execute(sql`
    SELECT id, status, attempts, lease_token AS "leaseToken",
      recipient_user_ids AS "recipientUserIds", sent_user_ids AS "sentUserIds",
      available_at > CURRENT_TIMESTAMP AS "scheduledForLater"
    FROM studio_offer_ssc_notification_outbox
    WHERE draft_id = ${input.draftId}
    ORDER BY created_at, event
  `);
}

async function makeDue(input: OfferSscNotificationInput) {
  await db.execute(sql`
    UPDATE studio_offer_ssc_notification_outbox
    SET available_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE draft_id = ${input.draftId}
  `);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "outbox-test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "outbox-test-secret");
  mocks.targets.mockResolvedValue([TARGET_A, TARGET_B]);
  mocks.post.mockImplementation(() => Promise.resolve());
});

afterEach(async () => {
  if (fixtureOrganizations.length > 0) {
    await db.delete(organization).where(inArray(organization.id, fixtureOrganizations.splice(0)));
  }
  vi.unstubAllEnvs();
});

// Opt-in must name the same isolated database used by the real application DAO.
describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "Offer SSC notification transactional outbox",
  () => {
    it("deduplicates repeated business events while retaining different revisions and events", async () => {
      const input = await fixture();
      await db.transaction(async (tx) => {
        await enqueueOfferSscNotification(tx, input);
        await enqueueOfferSscNotification(tx, input);
      });
      await enqueue(input);
      await enqueue({ ...input, event: "received" });
      await enqueue({ ...input, revision: 2 });
      expect(await jobs(input)).toHaveLength(3);
    });

    it("delivers only committed events and notifies the worker after commit", async () => {
      const input = await fixture();
      const notifications: string[] = [];
      const listener = await db.$client.listen("offer_ssc_notification_changed", (value) => {
        notifications.push(value);
      });
      try {
        await db.transaction(async (tx) => {
          await enqueueOfferSscNotification(tx, input);
          expect(await dispatchOfferSscNotifications()).toBe(0);
          expect(mocks.post).not.toHaveBeenCalled();
          expect(notifications).toHaveLength(0);
        });
        await vi.waitFor(() => expect(notifications).toHaveLength(1));
        expect(await dispatchOfferSscNotifications()).toBe(1);
        expect(mocks.post.mock.calls).toEqual([
          ["111", "SSC notification A"],
          ["222", "SSC notification B"],
        ]);
      } finally {
        await listener.unlisten();
      }
    });

    it("rolls back the notification with the Offer transaction", async () => {
      const input = await fixture();
      await expect(
        db.transaction(async (tx) => {
          await enqueueOfferSscNotification(tx, input);
          throw new Error("business transaction rolled back");
        }),
      ).rejects.toThrow("business transaction rolled back");
      expect(await jobs(input)).toHaveLength(0);
      expect(await dispatchOfferSscNotifications()).toBe(0);
      expect(mocks.post).not.toHaveBeenCalled();
    });

    it("freezes initial recipients and retries failures without repeating successful deliveries", async () => {
      const input = await fixture();
      await enqueue(input);
      mocks.post.mockImplementation((chatId: string) =>
        chatId === "222" ? Promise.reject(new Error("Telegram offline")) : Promise.resolve(),
      );
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(await jobs(input)).toMatchObject([
        {
          attempts: 1,
          recipientUserIds: ["ssc-a", "ssc-b"],
          scheduledForLater: true,
          sentUserIds: ["ssc-a"],
          status: "pending",
        },
      ]);
      mocks.targets.mockResolvedValue([
        TARGET_A,
        TARGET_B,
        { chatId: "333", message: "later recipient", userId: "ssc-c" },
      ]);
      mocks.post.mockImplementation(() => Promise.resolve());
      await makeDue(input);
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(mocks.post.mock.calls.map(([chatId]) => chatId)).toEqual(["111", "222", "222"]);
      expect(await jobs(input)).toMatchObject([
        { attempts: 2, sentUserIds: ["ssc-a", "ssc-b"], status: "completed" },
      ]);
      expect(await dispatchOfferSscNotifications()).toBe(0);
    });

    it("rechecks each frozen recipient before sending and uses their current binding", async () => {
      const input = await fixture();
      await enqueue(input);
      mocks.targets
        .mockResolvedValueOnce([TARGET_A, TARGET_B])
        .mockResolvedValue([{ ...TARGET_A, chatId: "999" }]);
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(mocks.post.mock.calls).toEqual([["999", "SSC notification A"]]);
      expect(await jobs(input)).toMatchObject([{ sentUserIds: ["ssc-a"], status: "completed" }]);
    });

    it.each(["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET_TOKEN"])(
      "does not claim or consume pending jobs without %s",
      async (key) => {
        const input = await fixture();
        await enqueue(input);
        vi.stubEnv(key, "");
        expect(await dispatchOfferSscNotifications()).toBe(0);
        expect(await jobs(input)).toMatchObject([
          { attempts: 0, recipientUserIds: null, sentUserIds: [], status: "pending" },
        ]);
        expect(mocks.post).not.toHaveBeenCalled();
      },
    );

    it("keeps an in-flight job claimed while another worker can query the outbox", async () => {
      const input = await fixture();
      await enqueue(input);
      const sending = Promise.withResolvers<boolean>();
      mocks.targets.mockResolvedValue([TARGET_A]);
      mocks.post.mockReturnValue(sending.promise);
      const firstWorker = dispatchOfferSscNotifications();
      try {
        await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
        expect(await dispatchOfferSscNotifications()).toBe(0);
        expect(await jobs(input)).toMatchObject([{ attempts: 1, status: "processing" }]);
      } finally {
        sending.resolve(true);
        await firstWorker;
      }
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    it("recovers an expired worker lease using persisted delivery progress", async () => {
      const input = await fixture();
      await enqueue(input);
      await db.execute(sql`
        UPDATE studio_offer_ssc_notification_outbox
        SET status = 'processing', attempts = 1, lease_token = 'dead-worker',
          lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second',
          recipient_user_ids = '["ssc-a", "ssc-b"]'::jsonb,
          sent_user_ids = '["ssc-a"]'::jsonb
        WHERE draft_id = ${input.draftId}
      `);
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(mocks.post.mock.calls).toEqual([["222", "SSC notification B"]]);
      expect(await jobs(input)).toMatchObject([
        { attempts: 2, sentUserIds: ["ssc-a", "ssc-b"], status: "completed" },
      ]);
    });

    it("does not acknowledge or continue sending after losing the lease token", async () => {
      const input = await fixture();
      await enqueue(input);
      mocks.post.mockImplementationOnce(async () => {
        await db.execute(sql`
          UPDATE studio_offer_ssc_notification_outbox
          SET lease_token = 'replacement-worker', lease_until = CURRENT_TIMESTAMP + INTERVAL '1 minute'
          WHERE draft_id = ${input.draftId}
        `);
      });
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(mocks.post.mock.calls).toEqual([["111", "SSC notification A"]]);
      expect(await jobs(input)).toMatchObject([
        { leaseToken: "replacement-worker", sentUserIds: [], status: "processing" },
      ]);
    });

    it("exhausts a crashed final attempt without sending a sixth time", async () => {
      const input = await fixture();
      await enqueue(input);
      await db.execute(sql`
        UPDATE studio_offer_ssc_notification_outbox
        SET status = 'processing', attempts = 5, lease_token = 'crashed-last-attempt',
          lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE draft_id = ${input.draftId}
      `);
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(await jobs(input)).toMatchObject([{ attempts: 5, status: "failed" }]);
      expect(mocks.post).not.toHaveBeenCalled();
    });

    it("stops failed deliveries after five attempts", async () => {
      const input = await fixture();
      await enqueue(input);
      mocks.targets.mockResolvedValue([TARGET_A]);
      mocks.post.mockRejectedValue(new Error("Telegram unavailable"));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await makeDue(input);
        expect(await dispatchOfferSscNotifications()).toBe(1);
      }
      expect(await jobs(input)).toMatchObject([{ attempts: 5, sentUserIds: [], status: "failed" }]);
      await makeDue(input);
      expect(await dispatchOfferSscNotifications()).toBe(0);
      expect(mocks.post).toHaveBeenCalledTimes(5);
    });
  },
);
