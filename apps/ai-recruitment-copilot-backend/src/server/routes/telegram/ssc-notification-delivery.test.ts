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
  studioOfferSscNotificationOutbox,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import { createOfferDraft } from "../studio/routes/interviews/dao/offer-drafts";
import { dispatchOfferSscNotifications } from "../studio/routes/interviews/dao/offer-ssc-notification-outbox";
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

    async function dispatchNewOffer() {
      const created = await createOfferDraft({
        input: { baseSalary: 100, position: "Notification-only Offer" },
        interviewRecordId: candidateId,
        organizationId: orgId,
      });
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(1);
      expect(transport.send.mock.calls[0][0]).toBe(chatId);
      const message = JSON.stringify(transport.send.mock.calls[0][1]);
      expect(message).toContain("Jon fixture");
      expect(message).toContain("登录系统查看并审核");
      expect(message).toContain(`/w/${orgId}/studio/resumes/${candidateId}?stage=offer`);
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

    it("sends without any system account or role and does not create an approval identity", async () => {
      await dispatchNewOffer();
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
      await dispatchNewOffer();
      expect(await db.select().from(user).where(eq(user.telegramChatId, chatId))).toHaveLength(2);
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toEqual([]);
    });
  },
);
