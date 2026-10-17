import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  jobDescription,
  member,
  organization,
  organizationRole,
  resumeSource,
  sscResponsibility,
  studioInterview,
  studioOfferDraft,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import { getOfferSscNotificationTargets } from "../studio/routes/interviews/utils/offer-ssc-notification";
import { resolveBoundTelegramOfferActor } from "./offer-ssc-dao";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC ledger Telegram routing",
  () => {
    let orgId: string;
    let sourceId: string;
    let candidateId: string;
    let draftId: string;
    let sscId: string;
    let email: string;
    let username: string;
    let chatId: string;
    const userIds: string[] = [];
    const chatIds: string[] = [];

    beforeEach(async () => {
      orgId = `test_ssc_tg_${randomUUID()}`;
      sourceId = randomUUID();
      candidateId = randomUUID();
      draftId = randomUUID();
      sscId = randomUUID();
      email = `${sscId}@example.com`;
      username = `ssc_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      chatId = String(randomInt(1_000_000, 999_999_999_999));
      userIds.push(sscId);
      chatIds.push(chatId);
      await db.insert(organization).values({ id: orgId, name: "SSC TG", slug: orgId });
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "SSC",
        organizationId: orgId,
        permission: JSON.stringify({ offer: ["read", "receive", "confirm"] }),
        role: "ssc-tg",
      });
      await db.insert(user).values({ email, id: sscId, name: "SSC TG profile" });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: orgId, role: "ssc-tg", userId: sscId });
      await db
        .insert(resumeSource)
        .values({ id: sourceId, name: "Assigned", organizationId: orgId });
      const departmentId = randomUUID();
      const jdId = randomUUID();
      await db
        .insert(department)
        .values({ id: departmentId, name: "Department", organizationId: orgId });
      await db.insert(jobDescription).values({
        departmentId,
        id: jdId,
        name: "Role",
        organizationId: orgId,
        prompt: "Test",
        resumeSourceId: sourceId,
      });
      await db.insert(studioInterview).values({
        candidateName: "Candidate",
        id: candidateId,
        jobDescriptionId: jdId,
        organizationId: orgId,
        pipelineStage: "offer",
      });
      await db.insert(studioOfferDraft).values({
        baseSalary: 100,
        id: draftId,
        interviewRecordId: candidateId,
        organizationId: orgId,
        position: "Role",
        sscConfirmationStatus: "pending",
        version: 1,
      });
      await db.insert(sscResponsibility).values({
        centerName: "Assigned",
        email: ` ${email.toUpperCase()} `,
        id: randomUUID(),
        organizationId: orgId,
        resumeSourceId: sourceId,
        sscName: "SSC",
        telegram: `@${username.toUpperCase()}`,
        workspaceRole: "ssc-tg",
      });
      await db.insert(telegramRecipientBinding).values({ chatId, username });
      vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test");
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, orgId));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, orgId));
      await db.delete(department).where(eq(department.organizationId, orgId));
      await db.delete(organization).where(eq(organization.id, orgId));
      await db.delete(user).where(inArray(user.id, userIds.splice(0)));
      await db
        .delete(telegramRecipientBinding)
        .where(inArray(telegramRecipientBinding.chatId, chatIds.splice(0)));
    });

    function targets() {
      return getOfferSscNotificationTargets({
        draftId,
        event: "pending",
        interviewRecordId: candidateId,
        organizationId: orgId,
        revision: 1,
      });
    }
    function actor(handle = username) {
      return resolveBoundTelegramOfferActor({ telegramUserId: chatId, username: handle });
    }

    it("routes source-assigned SSC through ledger username plus verified bot start without changing global profile", async () => {
      const notifications = await targets();
      expect(
        notifications.map(({ userId, chatId: target }) => ({ chatId: target, userId })),
      ).toEqual([{ chatId, userId: sscId }]);
      expect(await actor()).toBe(sscId);
      const [profile] = await db.select().from(user).where(eq(user.id, sscId));
      expect(profile.telegram).toBeNull();
      expect(profile.telegramChatId).toBeNull();
    });

    it("does not notify a broad administrator or SSC from a different source", async () => {
      const adminId = randomUUID();
      userIds.push(adminId);
      await db.insert(user).values({
        email: `${adminId}@example.com`,
        id: adminId,
        name: "Admin",
        telegram: "@admin_broad",
        telegramBoundUsername: "admin_broad",
        telegramChatId: "99882255",
      });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: orgId, role: "admin", userId: adminId });
      const notifications = await targets();
      expect(notifications.map((entry) => entry.userId)).toEqual([sscId]);
      await db
        .update(sscResponsibility)
        .set({ resumeSourceId: null })
        .where(eq(sscResponsibility.organizationId, orgId));
      expect(await targets()).toEqual([]);
      expect(await actor()).toBeNull();
    });

    it("requires a matching current private-chat binding and current username", async () => {
      expect(await actor("someone_else")).toBeNull();
      await db.delete(telegramRecipientBinding).where(eq(telegramRecipientBinding.chatId, chatId));
      expect(await actor()).toBeNull();
      expect(await targets()).toEqual([]);
    });

    it("pins the first numeric identity and rejects a username later moved to a different chat", async () => {
      expect(await actor()).toBe(sscId);
      const movedChat = String(randomInt(1_000_000, 999_999_999_999));
      chatIds.push(movedChat);
      await db.delete(telegramRecipientBinding).where(eq(telegramRecipientBinding.chatId, chatId));
      await db.insert(telegramRecipientBinding).values({ chatId: movedChat, username });
      expect(
        await resolveBoundTelegramOfferActor({ telegramUserId: movedChat, username }),
      ).toBeNull();
      expect(await targets()).toEqual([]);
    });

    it.each(["banned", "noAccess", "notSsc", "wrongRole"])(
      "denies %s identities despite a matching ledger TG",
      async (change) => {
        if (change === "banned") {
          await db.update(user).set({ banned: true }).where(eq(user.id, sscId));
        }
        if (change === "noAccess") {
          await db.update(member).set({ role: "noAccess" }).where(eq(member.userId, sscId));
        }
        if (change === "notSsc") {
          await db
            .update(organizationRole)
            .set({ isSsc: false })
            .where(eq(organizationRole.organizationId, orgId));
        }
        if (change === "wrongRole") {
          await db.insert(organizationRole).values({
            id: randomUUID(),
            isSsc: true,
            name: "Other SSC",
            organizationId: orgId,
            permission: "{}",
            role: "other-ssc",
          });
          await db
            .update(sscResponsibility)
            .set({ workspaceRole: "other-ssc" })
            .where(eq(sscResponsibility.organizationId, orgId));
        }
        expect(await actor()).toBeNull();
        expect(await targets()).toEqual([]);
      },
    );

    it("does not override an explicitly different personal TG identity", async () => {
      await db.update(user).set({ telegram: "@another_identity" }).where(eq(user.id, sscId));
      expect(await actor()).toBeNull();
      expect(await targets()).toEqual([]);
    });

    it.each(["chat", "handle"])(
      "does not deliver a ledger notification to another global user's %s identity",
      async (kind) => {
        const other = randomUUID();
        userIds.push(other);
        await db.insert(user).values({
          email: `${other}@example.com`,
          id: other,
          name: "Unrelated user",
          ...(kind === "chat" ? { telegramChatId: chatId } : { telegram: `@${username}` }),
        });
        expect(await targets()).toEqual([]);
      },
    );

    it("denies ambiguous global emails and ambiguous people sharing one ledger TG", async () => {
      const duplicate = randomUUID();
      userIds.push(duplicate);
      await db
        .insert(user)
        .values({ email: email.toUpperCase(), id: duplicate, name: "Ambiguous" });
      expect(await actor()).toBeNull();
      expect(await targets()).toEqual([]);
      await db.delete(user).where(eq(user.id, duplicate));
      const other = randomUUID();
      userIds.push(other);
      await db.insert(user).values({ email: `${other}@example.com`, id: other, name: "Other" });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: orgId, role: "ssc-tg", userId: other });
      await db.insert(sscResponsibility).values({
        centerName: "Assigned",
        email: `${other}@example.com`,
        id: randomUUID(),
        organizationId: orgId,
        resumeSourceId: sourceId,
        sscName: "Other",
        telegram: `@${username}`,
        workspaceRole: "ssc-tg",
      });
      expect(await actor()).toBeNull();
      expect(await targets()).toEqual([]);
    });

    it("deduplicates the same person across source ledger rows", async () => {
      await db.insert(sscResponsibility).values({
        centerName: "Pending other association",
        email,
        id: randomUUID(),
        organizationId: orgId,
        sscName: "SSC",
        telegram: `@${username}`,
        workspaceRole: "ssc-tg",
      });
      expect(await actor()).toBe(sscId);
      expect(await targets()).toHaveLength(1);
    });

    it("retains ordinary verified personal bindings for existing operator identities", async () => {
      await db
        .update(user)
        .set({ telegram: `@${username}`, telegramBoundUsername: username, telegramChatId: chatId })
        .where(eq(user.id, sscId));
      expect(await actor()).toBe(sscId);
      const notifications = await targets();
      expect(notifications.map((entry) => entry.chatId)).toEqual([chatId]);
      const [relation] = await db
        .select()
        .from(sscResponsibility)
        .where(
          and(
            eq(sscResponsibility.organizationId, orgId),
            eq(sscResponsibility.resumeSourceId, sourceId),
          ),
        );
      expect(relation.email.trim().toLowerCase()).toBe(email);
    });
  },
);
