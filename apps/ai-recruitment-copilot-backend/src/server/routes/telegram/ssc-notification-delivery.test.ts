import { randomInt, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  jobDescription,
  member,
  organization,
  resumeSource,
  sscResponsibility,
  sscTelegramIdentity,
  studioInterview,
  studioOfferDraft,
  studioOfferSscNotificationOutbox,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import { submitOfferRecruiterContact } from "../studio/routes/interviews/dao/offer-recruiter-contact";
import {
  dispatchOfferSscNotifications,
  enqueueOfferSscNotification,
} from "../studio/routes/interviews/dao/offer-ssc-notification-outbox";
import { createOfferWithRecruiterFixture } from "../../../test-utils/offer-notification-fixture";
import type * as TelegramBot from "./utils/bot";

const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./utils/bot", async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramBot>()),
  postTelegramDirectMessage: transport.send,
}));
const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC notification delivery without system identity resolution",
  () => {
    let orgId: string;
    let candidateId: string;
    let chatId: string;
    let username: string;
    const userIds: string[] = [];

    beforeEach(async () => {
      orgId = `test_ssc_delivery_${randomUUID()}`;
      candidateId = randomUUID();
      chatId = String(randomInt(1_000_000, 999_999_999_999));
      username = `ssc_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sourceId = randomUUID();
      const departmentId = randomUUID();
      const jobId = randomUUID();
      await db.insert(organization).values({ id: orgId, name: "SSC delivery", slug: orgId });
      await db
        .insert(resumeSource)
        .values({ id: sourceId, name: "Assigned source", organizationId: orgId });
      await db
        .insert(department)
        .values({ id: departmentId, name: "Department", organizationId: orgId });
      await db.insert(jobDescription).values({
        departmentId,
        id: jobId,
        name: "Role",
        organizationId: orgId,
        prompt: "Test",
        resumeSourceId: sourceId,
      });
      await db.insert(studioInterview).values({
        candidateName: "Jon fixture",
        id: candidateId,
        jobDescriptionId: jobId,
        organizationId: orgId,
        pipelineStage: "offer",
      });
      await db.insert(sscResponsibility).values({
        centerName: "Assigned source",
        email: "",
        id: randomUUID(),
        organizationId: orgId,
        resumeSourceId: sourceId,
        sscName: "SSC",
        telegram: `@${username}`,
      });
      await db.insert(telegramRecipientBinding).values({ chatId, username });
      vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "isolated-notification-token");
      vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "isolated-notification-secret");
      transport.send.mockReset().mockImplementation(() => Promise.resolve());
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, orgId));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, orgId));
      await db.delete(department).where(eq(department.organizationId, orgId));
      await db.delete(organization).where(eq(organization.id, orgId));
      if (userIds.length) {
        await db.delete(user).where(inArray(user.id, userIds.splice(0)));
      }
      await db.delete(telegramRecipientBinding).where(eq(telegramRecipientBinding.chatId, chatId));
    });

    async function dispatchLegacyOffer() {
      const created = { id: randomUUID() };
      await db.transaction(async (tx) => {
        await tx.insert(studioOfferDraft).values({
          baseSalary: 100,
          id: created.id,
          interviewRecordId: candidateId,
          organizationId: orgId,
          position: "Legacy notification-only Offer",
          recruiterConfirmationStatus: null,
          sscConfirmationStatus: "pending",
          version: 1,
        });
        await enqueueOfferSscNotification(tx, {
          draftId: created.id,
          event: "pending",
          interviewRecordId: candidateId,
          organizationId: orgId,
          revision: 1,
        });
      });
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(1);
      expect(transport.send.mock.calls[0][0]).toBe(chatId);
      const message = JSON.stringify(transport.send.mock.calls[0][1]);
      expect(message).toContain("Jon fixture");
      expect(message).toContain("查看候选人详情");
      expect(message).toContain('"id":"osr"');
      expect(message).toContain(`${created.id.replaceAll("-", "")}:1`);
      expect(message).toContain("/offer-candidate/");
      const [job] = await db
        .select()
        .from(studioOfferSscNotificationOutbox)
        .where(eq(studioOfferSscNotificationOutbox.draftId, created.id));
      expect(job).toMatchObject({
        attempts: 1,
        sentUserIds: [`telegram:${chatId}`],
        status: "completed",
      });
      expect(await dispatchOfferSscNotifications()).toBe(0);
      expect(transport.send).toHaveBeenCalledTimes(1);
    }

    it("sends a legacy Offer without any system account or role and does not create an approval identity", async () => {
      await dispatchLegacyOffer();
      expect(await db.select().from(member).where(eq(member.organizationId, orgId))).toEqual([]);
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toEqual([]);
    });

    it("sends once when two system accounts retain the same TG binding without changing either account", async () => {
      const ids = [randomUUID(), randomUUID()];
      userIds.push(...ids);
      await db.insert(user).values(
        ids.map((id) => ({
          email: `${id}@example.com`,
          id,
          name: "Duplicate TG fixture",
          telegramBoundUsername: username,
          telegramChatId: chatId,
        })),
      );
      await db.insert(member).values(
        ids.map((id) => ({
          id: randomUUID(),
          organizationId: orgId,
          role: "member",
          userId: id,
        })),
      );
      await dispatchLegacyOffer();
      expect(await db.select().from(user).where(eq(user.telegramChatId, chatId))).toHaveLength(2);
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toEqual([]);
    });

    it("notifies the uploader before delivering a new Offer to an SSC without a system account", async () => {
      const { draft, recruiterChatId, recruiterId, revision } =
        await createOfferWithRecruiterFixture({
          input: { baseSalary: 100, position: "New gated Offer" },
          interviewRecordId: candidateId,
          organizationId: orgId,
          userIds,
        });
      expect(draft.recruiterConfirmationStatus).toBe("pending");
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledOnce();
      expect(transport.send.mock.calls[0][0]).toBe(recruiterChatId);
      const recruiterCard = JSON.stringify(transport.send.mock.calls[0][1]);
      expect(recruiterCard).toContain('"id":"orc"');
      expect(recruiterCard).not.toContain('"id":"osr"');
      const before = await db
        .select()
        .from(studioOfferSscNotificationOutbox)
        .where(eq(studioOfferSscNotificationOutbox.draftId, draft.id));
      expect(before.map((job) => job.event)).toEqual(["recruiter"]);
      await submitOfferRecruiterContact({
        actorUserId: recruiterId,
        candidatePrivateTelegram: "@CandidatePrivate",
        draftId: draft.id,
        interviewRecordId: candidateId,
        organizationId: orgId,
        revision,
        source: "system",
      });
      transport.send.mockClear();
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledOnce();
      expect(transport.send.mock.calls[0][0]).toBe(chatId);
      const sscCard = JSON.stringify(transport.send.mock.calls[0][1]);
      expect(sscCard).toContain('"id":"osr"');
      expect(sscCard).toContain("@CandidatePrivate");
      expect(await db.select().from(member).where(eq(member.organizationId, orgId))).toMatchObject([
        { userId: recruiterId },
      ]);
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toEqual([]);
      expect(await dispatchOfferSscNotifications()).toBe(0);
      expect(transport.send).toHaveBeenCalledOnce();
    });
  },
);
