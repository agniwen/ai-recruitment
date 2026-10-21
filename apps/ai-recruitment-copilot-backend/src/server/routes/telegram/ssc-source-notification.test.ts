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
  studioOfferSscNotificationOutbox,
  sscTelegramIdentity,
  telegramRecipientBinding,
  telegramRequesterBinding,
  user,
} from "@arc/db-schema/schema";
import { getOfferSscNotificationTargets } from "../studio/routes/interviews/utils/offer-ssc-notification";
import { resolveExternalInterviewerBindings } from "../studio/routes/interviews/dao/external-interviewers";
import { resolveBoundTelegramOfferActor } from "./offer-ssc-dao";
import { bindTelegramUser } from "./dao";
import { resolveLedgerTelegramOfferActor } from "./ssc-recipients";
import {
  completeOfferSscConfirmation,
  createOfferDraft,
  loadAuthorizedOfferSscContext,
  receiveOfferSscConfirmation,
} from "../studio/routes/interviews/dao/offer-drafts";
import { dispatchOfferSscNotifications } from "../studio/routes/interviews/dao/offer-ssc-notification-outbox";
import type * as TelegramBot from "./utils/bot";

const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./utils/bot", async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramBot>()),
  postTelegramDirectMessage: transport.send,
}));

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
    const extraOrganizationIds: string[] = [];

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
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "notification-test-token");
      vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "notification-test-secret");
      transport.send.mockReset().mockImplementation(() => Promise.resolve());
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      const identities = await db
        .select()
        .from(sscTelegramIdentity)
        .where(inArray(sscTelegramIdentity.chatId, chatIds));
      userIds.push(...identities.map((entry) => entry.userId));
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, orgId));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, orgId));
      await db.delete(department).where(eq(department.organizationId, orgId));
      await db.delete(organization).where(eq(organization.id, orgId));
      if (extraOrganizationIds.length) {
        await db
          .delete(organization)
          .where(inArray(organization.id, extraOrganizationIds.splice(0)));
      }
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

    it("ignores another workspace's conflicting SSC email when sending to the current source TG", async () => {
      const otherOrg = `test_ssc_delivery_${randomUUID()}`;
      const otherSource = randomUUID();
      extraOrganizationIds.push(otherOrg);
      await db.insert(organization).values({ id: otherOrg, name: "Other", slug: otherOrg });
      await db
        .insert(resumeSource)
        .values({ id: otherSource, name: "Other source", organizationId: otherOrg });
      await db.insert(sscResponsibility).values({
        centerName: "Other source",
        email,
        id: randomUUID(),
        organizationId: otherOrg,
        resumeSourceId: otherSource,
        sscName: "Someone else",
        telegram: `@${username}`,
      });
      await db.update(user).set({ telegram: "@different_person" }).where(eq(user.id, sscId));
      const notifications = await targets();
      expect(notifications.map((target) => target.chatId)).toEqual([chatId]);
      expect(JSON.stringify(notifications[0].message)).toContain(
        `/w/${orgId}/studio/resumes/${candidateId}`,
      );
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toEqual([]);
    });

    describe("legacy verified Telegram bindings", () => {
      beforeEach(async () => {
        await db
          .update(sscResponsibility)
          .set({ email: "" })
          .where(eq(sscResponsibility.organizationId, orgId));
        await db
          .delete(telegramRecipientBinding)
          .where(eq(telegramRecipientBinding.chatId, chatId));
      });

      async function addRequesterBinding(organizationId = orgId, recipientChatId = chatId) {
        await db.insert(telegramRequesterBinding).values({
          chatId: recipientChatId,
          organizationId,
          username,
        });
      }

      async function addOtherOrganization() {
        const id = `test_ssc_legacy_${randomUUID()}`;
        extraOrganizationIds.push(id);
        await db.insert(organization).values({ id, name: "Other workspace", slug: id });
        return id;
      }

      async function externalBinding(organizationId = orgId) {
        const [result] = await resolveExternalInterviewerBindings(organizationId, [
          { name: "Legacy SSC", telegram: `@${username}` },
        ]);
        return result.chatId;
      }

      async function removeSystemAccount() {
        await db.delete(member).where(eq(member.userId, sscId));
        await db.delete(user).where(eq(user.id, sscId));
      }

      it.each(["same-workspace requester without an account", "verified personal profile"])(
        "dispatches a blank-email Offer from a %s independently, then completes after SSC identity resolution",
        async (bindingKind) => {
          if (bindingKind === "same-workspace requester without an account") {
            await removeSystemAccount();
            await addRequesterBinding();
          } else {
            await db
              .update(user)
              .set({
                telegram: `@${username}`,
                telegramBoundUsername: username,
                telegramChatId: chatId,
              })
              .where(eq(user.id, sscId));
          }
          expect(await externalBinding()).toBe(chatId);
          expect(
            await db
              .select()
              .from(telegramRecipientBinding)
              .where(eq(telegramRecipientBinding.chatId, chatId)),
          ).toEqual([]);

          const created = await createOfferDraft({
            input: { baseSalary: 23_456, position: "Legacy-bound SSC Offer" },
            interviewRecordId: candidateId,
            organizationId: orgId,
          });
          draftId = created.id;
          expect(await dispatchOfferSscNotifications()).toBe(1);
          expect(transport.send).toHaveBeenCalledTimes(1);
          expect(transport.send.mock.calls[0][0]).toBe(chatId);

          const [job] = await db
            .select()
            .from(studioOfferSscNotificationOutbox)
            .where(eq(studioOfferSscNotificationOutbox.draftId, draftId));
          expect(job.status).toBe("completed");
          expect(job.sentUserIds).toHaveLength(1);
          // Approval identity resolution is separate from notification delivery.
          expect(
            await resolveLedgerTelegramOfferActor({ telegramUserId: chatId, username }),
          ).toBeTruthy();
          const actorId = await actor();
          expect(job.sentUserIds).toEqual([`telegram:${chatId}`]);
          if (!actorId) {
            throw new Error("Expected a pinned SSC actor for the verified legacy recipient");
          }
          const [pin] = await db
            .select()
            .from(sscTelegramIdentity)
            .where(eq(sscTelegramIdentity.chatId, chatId));
          expect(pin).toMatchObject({ chatId, userId: actorId, username });
          const input = {
            actor: { id: actorId, role: "ssc-tg" },
            draftId,
            interviewRecordId: candidateId,
            organizationId: orgId,
            revision: 1,
            source: "telegram" as const,
          };
          const received = await receiveOfferSscConfirmation(input);
          expect(received.sscConfirmationStatus).toBe("confirming");
          const completed = await completeOfferSscConfirmation({
            ...input,
            internalApprovalConfirmed: true,
          });
          expect(completed.sscConfirmationStatus).toBe("completed");
          expect(completed.sscCompletedBy).toBe(actorId);
          const [relation] = await db
            .select()
            .from(sscResponsibility)
            .where(eq(sscResponsibility.organizationId, orgId));
          expect(relation.email).toBe("");
        },
      );

      it("does not promote a requester binding from another workspace", async () => {
        const otherOrganizationId = await addOtherOrganization();
        await addRequesterBinding(otherOrganizationId);
        expect(await externalBinding(otherOrganizationId)).toBe(chatId);
        expect(await externalBinding()).toBeNull();
        expect(await targets()).toEqual([]);
        expect(await actor()).toBeNull();
        expect(
          await db
            .select()
            .from(telegramRecipientBinding)
            .where(eq(telegramRecipientBinding.chatId, chatId)),
        ).toEqual([]);
      });

      it.each([null, "renamed_legacy_owner"])(
        "does not resurrect a legacy binding when the canonical chat username is %s",
        async (currentUsername) => {
          await addRequesterBinding();
          await db.insert(telegramRecipientBinding).values({ chatId, username: currentUsername });
          expect(await externalBinding()).toBe(chatId);
          expect(await targets()).toEqual([]);
          const [binding] = await db
            .select()
            .from(telegramRecipientBinding)
            .where(eq(telegramRecipientBinding.chatId, chatId));
          expect(binding.username).toBe(currentUsername);
          expect(
            await db
              .select()
              .from(sscTelegramIdentity)
              .where(eq(sscTelegramIdentity.chatId, chatId)),
          ).toEqual([]);
        },
      );

      it("keeps the current canonical chat ahead of a stale requester binding", async () => {
        const currentChatId = String(randomInt(1_000_000, 999_999_999_999));
        chatIds.push(currentChatId);
        await removeSystemAccount();
        await addRequesterBinding();
        await db.insert(telegramRecipientBinding).values({ chatId: currentChatId, username });
        expect(await externalBinding()).toBe(currentChatId);
        const notifications = await targets();
        expect(notifications.map((target) => target.chatId)).toEqual([currentChatId]);
        expect(
          await db
            .select()
            .from(telegramRecipientBinding)
            .where(eq(telegramRecipientBinding.chatId, chatId)),
        ).toEqual([]);
      });

      it.each(["another workspace requester", "verified profile"])(
        "sends via the workspace's legacy chat without promoting conflicting %s approval identities",
        async (conflictKind) => {
          const otherChatId = String(randomInt(1_000_000, 999_999_999_999));
          chatIds.push(otherChatId);
          await addRequesterBinding();
          await (conflictKind === "another workspace requester"
            ? addRequesterBinding(await addOtherOrganization(), otherChatId)
            : db
                .update(user)
                .set({
                  telegram: `@${username}`,
                  telegramBoundUsername: username,
                  telegramChatId: otherChatId,
                })
                .where(eq(user.id, sscId)));
          expect(await externalBinding()).toBe(chatId);
          expect(await targets()).toHaveLength(1);
          expect(
            await db
              .select()
              .from(telegramRecipientBinding)
              .where(eq(telegramRecipientBinding.username, username)),
          ).toEqual([]);
          expect(
            await db
              .select()
              .from(sscTelegramIdentity)
              .where(eq(sscTelegramIdentity.username, username)),
          ).toEqual([]);
        },
      );

      it("deduplicates concurrent legacy notification resolution independently of audit identity creation", async () => {
        await removeSystemAccount();
        await addRequesterBinding();
        expect(await externalBinding()).toBe(chatId);
        const results = await Promise.all([targets(), targets(), targets()]);
        for (const result of results) {
          expect(result).toHaveLength(1);
          expect(result[0].chatId).toBe(chatId);
        }
        expect(new Set(results.map((result) => result[0].userId)).size).toBe(1);
        expect(results[0][0].userId).toBe(`telegram:${chatId}`);
        expect(await actor()).toBeTruthy();
        expect(
          await db
            .select()
            .from(telegramRecipientBinding)
            .where(eq(telegramRecipientBinding.username, username)),
        ).toHaveLength(1);
        expect(
          await db
            .select()
            .from(sscTelegramIdentity)
            .where(eq(sscTelegramIdentity.username, username)),
        ).toHaveLength(1);
        expect(await db.select().from(member).where(eq(member.organizationId, orgId))).toHaveLength(
          1,
        );
        const repeated = await targets();
        expect(repeated.map((target) => target.userId)).toEqual([results[0][0].userId]);
      });
    });

    it("automatically sends the actual newly created Offer without checking system account permissions", async () => {
      await db
        .update(sscResponsibility)
        .set({ email: "" })
        .where(eq(sscResponsibility.organizationId, orgId));
      await db
        .update(organizationRole)
        .set({ permission: JSON.stringify({ offer: ["read"] }) })
        .where(eq(organizationRole.organizationId, orgId));
      const created = await createOfferDraft({
        actorId: sscId,
        actorRole: "owner",
        input: { baseSalary: 23_456, currency: "CNY", position: "Current system Offer" },
        interviewRecordId: candidateId,
        organizationId: orgId,
      });
      expect(await dispatchOfferSscNotifications()).toBe(1);
      expect(transport.send).toHaveBeenCalledTimes(1);
      const [[recipient, card]] = transport.send.mock.calls;
      expect(recipient).toBe(chatId);
      const serialized = JSON.stringify(card);
      expect(serialized).toContain("Candidate");
      expect(serialized).toContain("Current system Offer");
      expect(serialized).toContain("登录系统查看并审核");
      expect(serialized).toContain(`/w/${orgId}/studio/resumes/${candidateId}?stage=offer`);
      expect(serialized).toContain('"id":"osr"');
      expect(serialized).not.toContain("/offer-candidate/");
      const [job] = await db
        .select()
        .from(studioOfferSscNotificationOutbox)
        .where(eq(studioOfferSscNotificationOutbox.draftId, created.id));
      expect(job.status).toBe("completed");
      expect(job.sentUserIds).toHaveLength(1);
      expect(await dispatchOfferSscNotifications()).toBe(0);
      expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it("lets an unregistered follower receive and complete an assigned Offer without an email", async () => {
      await db
        .update(sscResponsibility)
        .set({ email: "" })
        .where(eq(sscResponsibility.organizationId, orgId));
      await db.delete(member).where(eq(member.userId, sscId));
      await db.delete(user).where(eq(user.id, sscId));
      const binding = await bindTelegramUser({ chatId, username });
      expect(binding.kind).toBe("bound");
      const notifications = await targets();
      expect(notifications.map((entry) => entry.chatId)).toEqual([chatId]);
      const actorId = await actor();
      expect(notifications[0].userId).toBe(`telegram:${chatId}`);
      if (!actorId) {
        throw new Error("Expected a provisioned SSC audit identity");
      }
      const [profile] = await db.select().from(user).where(eq(user.id, actorId));
      expect(profile.emailVerified).toBe(false);
      const [relation] = await db
        .select()
        .from(sscResponsibility)
        .where(eq(sscResponsibility.organizationId, orgId));
      expect(relation.email).toBe("");
      const input = {
        actor: { id: actorId, role: "ssc-tg" },
        draftId,
        interviewRecordId: candidateId,
        organizationId: orgId,
        revision: 1,
        source: "telegram" as const,
      };
      const received = await receiveOfferSscConfirmation(input);
      expect(received.sscConfirmationStatus).toBe("confirming");
      const completed = await completeOfferSscConfirmation({
        ...input,
        internalApprovalConfirmed: true,
      });
      expect(completed.sscConfirmationStatus).toBe("completed");
      expect(completed.sscCompletedBy).toBe(actorId);
    });

    it("uses a pinned follower for a blank-email assignment in another responsible source", async () => {
      expect(await actor()).toBe(sscId);
      await db
        .update(sscResponsibility)
        .set({ email: "" })
        .where(eq(sscResponsibility.organizationId, orgId));
      const notifications = await targets();
      expect(notifications.map((entry) => entry.userId)).toEqual([`telegram:${chatId}`]);
      expect(await actor()).toBe(sscId);
      const context = await loadAuthorizedOfferSscContext({ actorUserId: sscId, draftId });
      expect(context.canReceive).toBe(true);
      await db
        .update(sscResponsibility)
        .set({ resumeSourceId: null })
        .where(eq(sscResponsibility.organizationId, orgId));
      await expect(
        loadAuthorizedOfferSscContext({ actorUserId: sscId, draftId }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("provisions one audit identity and membership when the same follower is resolved concurrently", async () => {
      await db
        .update(sscResponsibility)
        .set({ email: "" })
        .where(eq(sscResponsibility.organizationId, orgId));
      await db.delete(member).where(eq(member.userId, sscId));
      await db.delete(user).where(eq(user.id, sscId));
      const actors = await Promise.all([actor(), actor(), actor()]);
      expect(actors[0]).toBeTruthy();
      expect(new Set(actors).size).toBe(1);
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toHaveLength(1);
      expect(await db.select().from(member).where(eq(member.organizationId, orgId))).toHaveLength(
        1,
      );
      const notifications = await targets();
      expect(notifications.map((entry) => entry.userId)).toEqual([`telegram:${chatId}`]);
    });

    it("revokes a pinned TG actor's candidate access when the responsibility belongs to another registered person", async () => {
      expect(await actor()).toBe(sscId);
      const otherId = randomUUID();
      userIds.push(otherId);
      const otherEmail = `${otherId}@example.com`;
      await db.insert(user).values({ email: otherEmail, id: otherId, name: "Reassigned SSC" });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: orgId, role: "ssc-tg", userId: otherId });
      await db
        .update(sscResponsibility)
        .set({ email: otherEmail })
        .where(eq(sscResponsibility.organizationId, orgId));
      expect(await targets()).toHaveLength(1);
      await expect(
        loadAuthorizedOfferSscContext({ actorUserId: sscId, draftId }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("does not create an approval identity for an unverified follower or unlinked source", async () => {
      await db
        .update(sscResponsibility)
        .set({ email: "" })
        .where(eq(sscResponsibility.organizationId, orgId));
      await db.delete(telegramRecipientBinding).where(eq(telegramRecipientBinding.chatId, chatId));
      expect(await targets()).toEqual([]);
      expect(await actor()).toBeNull();
      expect(
        await db.select().from(sscTelegramIdentity).where(eq(sscTelegramIdentity.chatId, chatId)),
      ).toEqual([]);
    });

    it("keeps blank-email access bound to the pinned numeric TG account after a username transfer", async () => {
      expect(await actor()).toBe(sscId);
      await db
        .update(sscResponsibility)
        .set({ email: "" })
        .where(eq(sscResponsibility.organizationId, orgId));
      const otherChat = String(randomInt(1_000_000, 999_999_999_999));
      chatIds.push(otherChat);
      await db.delete(telegramRecipientBinding).where(eq(telegramRecipientBinding.chatId, chatId));
      await db.insert(telegramRecipientBinding).values({ chatId: otherChat, username });
      expect(
        await resolveBoundTelegramOfferActor({ telegramUserId: otherChat, username }),
      ).toBeNull();
      const notifications = await targets();
      expect(notifications.map((target) => target.chatId)).toEqual([otherChat]);
      await expect(
        loadAuthorizedOfferSscContext({ actorUserId: sscId, draftId }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("routes source-assigned SSC through ledger username plus verified bot start without changing global profile", async () => {
      const notifications = await targets();
      expect(
        notifications.map(({ userId, chatId: target }) => ({ chatId: target, userId })),
      ).toEqual([{ chatId, userId: `telegram:${chatId}` }]);
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
      expect(notifications.map((entry) => entry.userId)).toEqual([`telegram:${chatId}`]);
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
      const notifications = await targets();
      expect(notifications.map((target) => target.chatId)).toEqual([movedChat]);
    });

    it.each(["banned", "noAccess", "notSsc", "wrongRole"])(
      "keeps %s approval restrictions without blocking the configured notification chat",
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
        expect(await targets()).toHaveLength(1);
      },
    );

    it("does not override an explicitly different personal TG identity", async () => {
      await db.update(user).set({ telegram: "@another_identity" }).where(eq(user.id, sscId));
      expect(await actor()).toBeNull();
      expect(await targets()).toHaveLength(1);
    });

    it.each(["chat", "handle"])(
      "ignores another system user's %s identity when sending to the configured verified chat",
      async (kind) => {
        const other = randomUUID();
        userIds.push(other);
        await db.insert(user).values({
          email: `${other}@example.com`,
          id: other,
          name: "Unrelated user",
          ...(kind === "chat" ? { telegramChatId: chatId } : { telegram: `@${username}` }),
        });
        expect(await targets()).toHaveLength(1);
      },
    );

    it("keeps approval identity ambiguity separate from one notification per ledger TG", async () => {
      const duplicate = randomUUID();
      userIds.push(duplicate);
      await db
        .insert(user)
        .values({ email: email.toUpperCase(), id: duplicate, name: "Ambiguous" });
      expect(await actor()).toBeNull();
      expect(await targets()).toHaveLength(1);
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
      expect(await targets()).toHaveLength(1);
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

    it("does not move a pinned personal SSC actor when a new numeric account starts the bot with its old username", async () => {
      await db
        .update(user)
        .set({ telegram: `@${username}`, telegramBoundUsername: username, telegramChatId: chatId })
        .where(eq(user.id, sscId));
      expect(await resolveLedgerTelegramOfferActor({ telegramUserId: chatId, username })).toBe(
        sscId,
      );
      expect(await targets()).toHaveLength(1);
      const movedChat = String(randomInt(1_000_000, 999_999_999_999));
      chatIds.push(movedChat);
      await bindTelegramUser({ chatId: movedChat, username });
      expect(
        await resolveBoundTelegramOfferActor({ telegramUserId: movedChat, username }),
      ).toBeNull();
      const notifications = await targets();
      expect(notifications.map((target) => target.chatId)).toEqual([movedChat]);
    });
  },
);
