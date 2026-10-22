import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { provisionSscUserOnSignIn } from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import {
  member,
  organization,
  organizationRole,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { listWorkspaceMemberProfiles } from "../dao";

const testDatabase = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;

describe.skipIf(!testDatabase || testDatabase !== process.env.DATABASE_URL)(
  "SSC member Telegram contact",
  () => {
    const organizations: string[] = [];
    const users: string[] = [];
    let organizationId: string;
    let userId: string;
    let email: string;

    async function workspace() {
      const id = randomUUID();
      organizations.push(id);
      await db.insert(organization).values({ id, name: "SSC contact test", slug: id });
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "SSC",
        organizationId: id,
        permission: "{}",
        role: "ssc-contact",
      });
      return id;
    }

    async function entry(telegram: string, scope = organizationId) {
      const id = randomUUID();
      await db.insert(sscResponsibility).values({
        centerName: id,
        email: ` ${email.toUpperCase()} `,
        id,
        organizationId: scope,
        sscName: "SSC contact",
        telegram,
        workspaceRole: "ssc-contact",
      });
      return id;
    }

    async function current() {
      const rows = await listWorkspaceMemberProfiles(organizationId);
      return rows.find((row) => row.userId === userId);
    }

    beforeEach(async () => {
      organizationId = await workspace();
      userId = randomUUID();
      users.push(userId);
      email = `${userId}@example.test`;
      await db.insert(user).values({ email, emailVerified: true, id: userId, name: "Google SSC" });
    });

    afterEach(async () => {
      await db.delete(organization).where(inArray(organization.id, organizations.splice(0)));
      await db.delete(user).where(inArray(user.id, users.splice(0)));
    });

    it("shows the ledger TG after Google sign-in without writing a verified personal identity", async () => {
      await entry("  @Ledger_SSC  ");
      await provisionSscUserOnSignIn({ email, userId });
      expect(await current()).toMatchObject({
        profileTelegram: null,
        telegram: "@ledger_ssc",
        telegramSource: "ssc",
        userId,
      });
      const [stored] = await db.select().from(user).where(eq(user.id, userId));
      expect(stored).toMatchObject({
        name: "Google SSC",
        telegram: null,
        telegramBoundUsername: null,
        telegramChatId: null,
      });
    });

    it("updates an already registered member from the ledger without another login", async () => {
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId, role: "ssc-contact", userId });
      const id = await entry("@first_ssc");
      expect(await current()).toMatchObject({ telegram: "@first_ssc" });
      await db
        .update(sscResponsibility)
        .set({ telegram: "@updated_ssc" })
        .where(eq(sscResponsibility.id, id));
      expect(await current()).toMatchObject({
        profileTelegram: null,
        telegram: "@updated_ssc",
        telegramSource: "ssc",
      });
    });

    it("keeps an existing personal Telegram and its numeric binding unchanged", async () => {
      await entry("@ledger_ssc");
      await db
        .update(user)
        .set({
          telegram: "@personal_ssc",
          telegramBoundUsername: "personal_ssc",
          telegramChatId: "123456789",
        })
        .where(eq(user.id, userId));
      await provisionSscUserOnSignIn({ email, userId });
      expect(await current()).toMatchObject({
        profileTelegram: "@personal_ssc",
        telegram: "@personal_ssc",
        telegramSource: "profile",
      });
      const [stored] = await db.select().from(user).where(eq(user.id, userId));
      expect(stored).toMatchObject({
        telegramBoundUsername: "personal_ssc",
        telegramChatId: "123456789",
      });
    });

    it("never borrows the same email contact from another workspace", async () => {
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId, role: "ssc-contact", userId });
      await entry("@foreign_ssc", await workspace());
      expect(await current()).toMatchObject({ telegram: null, telegramSource: null });
    });

    it("does not choose between different ledger TG handles", async () => {
      await entry("@first_ssc");
      await entry("@second_ssc");
      await provisionSscUserOnSignIn({ email, userId });
      expect(await current()).toMatchObject({ telegram: null, telegramSource: null });
    });

    it.each(["member", "noAccess", "banned"])(
      "does not attach SSC contact to a %s account",
      async (kind) => {
        await entry("@ledger_ssc");
        await db.insert(member).values({
          id: randomUUID(),
          organizationId,
          role: kind === "banned" ? "ssc-contact" : kind,
          userId,
        });
        if (kind === "banned") {
          await db.update(user).set({ banned: true }).where(eq(user.id, userId));
        }
        expect(await current()).toMatchObject({ telegram: null, telegramSource: null });
      },
    );

    it("leaves an ambiguous canonical email unresolved", async () => {
      await entry("@ledger_ssc");
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId, role: "ssc-contact", userId });
      const duplicateId = randomUUID();
      users.push(duplicateId);
      await db
        .insert(user)
        .values({ email: email.toUpperCase(), id: duplicateId, name: "Different account" });
      expect(await current()).toMatchObject({ telegram: null, telegramSource: null });
    });
  },
);
