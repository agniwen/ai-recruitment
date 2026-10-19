import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  member,
  organization,
  organizationRole,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { db } from "./db";
import { provisionSscUserOnSignIn, syncSscMemberRole } from "./ssc-provisioning";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC sign-in provisioning",
  () => {
    let organizationId: string;
    let userId: string;
    let email: string;
    const userIds: string[] = [];

    beforeEach(async () => {
      organizationId = `test_ssc_sign_in_${randomUUID()}`;
      userId = randomUUID();
      email = `${userId}@example.com`;
      userIds.push(userId);
      await db
        .insert(organization)
        .values({ id: organizationId, name: "SSC sign-in", slug: organizationId });
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "SSC",
        organizationId,
        permission: "{}",
        role: "ssc-test",
      });
      await db.insert(user).values({
        email,
        id: userId,
        name: "Existing profile",
        telegramChatId: "verified-telegram",
      });
      await db.insert(sscResponsibility).values({
        centerName: "Pending association",
        email: ` ${email.toUpperCase()} `,
        id: randomUUID(),
        organizationId,
        sscName: "Pre-entry name",
        telegram: "@unverified",
        workspaceRole: "ssc-test",
      });
    });

    afterEach(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, userIds.splice(0)));
    });

    async function currentMember() {
      const [record] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
      return record;
    }

    it("creates one membership on first login without changing the verified global profile", async () => {
      await provisionSscUserOnSignIn({ email, userId });
      await provisionSscUserOnSignIn({ email, userId });
      const records = await db
        .select()
        .from(member)
        .where(eq(member.organizationId, organizationId));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ role: "ssc-test", userId });
      const [profile] = await db.select().from(user).where(eq(user.id, userId));
      expect(profile).toMatchObject({
        name: "Existing profile",
        telegramChatId: "verified-telegram",
      });
    });

    it.each(["admin", "owner", "noAccess", "manually-assigned-role"])(
      "preserves an existing %s role on subsequent login",
      async (role) => {
        await db.insert(member).values({ id: randomUUID(), organizationId, role, userId });
        await provisionSscUserOnSignIn({ email, userId });
        expect(await currentMember()).toMatchObject({ role });
      },
    );

    it("does not provision a banned account or a different account using the email", async () => {
      await provisionSscUserOnSignIn({ email, userId: "different-account" });
      expect(await currentMember()).toBeUndefined();
      await db.update(user).set({ banned: true }).where(eq(user.id, userId));
      await provisionSscUserOnSignIn({ email, userId });
      expect(await currentMember()).toBeUndefined();
    });

    it("does not create membership after the last SSC intention has been revoked", async () => {
      await db
        .delete(sscResponsibility)
        .where(eq(sscResponsibility.organizationId, organizationId));
      await db.transaction(async (tx) => {
        expect(
          await syncSscMemberRole(tx, {
            allowExistingRoleUpdate: false,
            email,
            expectedUserId: userId,
            organizationId,
            workspaceRole: "ssc-test",
          }),
        ).toEqual({ status: "role_conflict" });
      });
      expect(await currentMember()).toBeUndefined();
    });

    it("keeps conflicting SSC role intents pending instead of choosing one", async () => {
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "Other SSC",
        organizationId,
        permission: "{}",
        role: "ssc-other",
      });
      await db.insert(sscResponsibility).values({
        centerName: "Other pending center",
        email,
        id: randomUUID(),
        organizationId,
        sscName: "",
        workspaceRole: "ssc-other",
      });
      await provisionSscUserOnSignIn({ email, userId });
      expect(await currentMember()).toBeUndefined();
    });

    it("denies ambiguous canonical emails and leaves both profiles unchanged", async () => {
      const otherId = randomUUID();
      userIds.push(otherId);
      await db
        .insert(user)
        .values({ email: email.toUpperCase(), id: otherId, name: "Other profile" });
      await db.transaction(async (tx) => {
        expect(
          await syncSscMemberRole(tx, {
            allowExistingRoleUpdate: true,
            email,
            organizationId,
            workspaceRole: "ssc-test",
          }),
        ).toEqual({ status: "ambiguous_email" });
      });
      expect(await currentMember()).toBeUndefined();
    });
  },
);
