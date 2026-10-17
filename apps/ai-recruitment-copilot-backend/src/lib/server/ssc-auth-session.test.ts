import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  account,
  member,
  organization,
  organizationRole,
  resumeSource,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { resolveSscAccessActor } from "@arc/ai-recruitment-copilot-backend/server/access/ssc-access";
import { db } from "./db";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;

// Exercise the application's native OAuth-user/session adapter and database
// hooks after provider verification. This does not simulate Google's network.
describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC native authenticated session wiring",
  () => {
    let organizationId: string;
    let sourceId: string;
    let email: string;
    const userIds: string[] = [];

    beforeEach(async () => {
      organizationId = `test_ssc_session_${randomUUID()}`;
      sourceId = randomUUID();
      email = `${randomUUID()}@example.com`;
      await db.insert(organization).values({
        id: organizationId,
        name: "SSC session integration",
        slug: organizationId,
      });
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "SSC audit",
        organizationId,
        permission: "{}",
        role: "ssc-session",
      });
      await db
        .insert(resumeSource)
        .values({ id: sourceId, name: "Assigned center", organizationId });
      await db.insert(sscResponsibility).values({
        centerName: "Assigned center",
        email: ` ${email.toUpperCase()} `,
        id: randomUUID(),
        organizationId,
        resumeSourceId: sourceId,
        sscName: "Pre-entered SSC",
        workspaceRole: "ssc-session",
      });
    });

    afterEach(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      for (const id of userIds.splice(0)) {
        await db.delete(user).where(eq(user.id, id));
      }
    });

    async function createVerifiedGoogleIdentity(identityEmail = email) {
      const { auth } = await import("./auth");
      const context = await auth.$context;
      const created = await context.internalAdapter.createOAuthUser(
        { email: identityEmail, emailVerified: true, name: "Verified Google name" },
        { accountId: randomUUID(), providerId: "google" },
      );
      userIds.push(created.user.id);
      return { context, profile: created.user };
    }

    function memberships(userId: string) {
      return db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
    }

    it("creates a Google user then applies the SSC pre-entry through the real session hook", async () => {
      const { context, profile } = await createVerifiedGoogleIdentity();
      expect(await memberships(profile.id)).toEqual([]);
      await context.internalAdapter.createSession(profile.id);
      await context.internalAdapter.createSession(profile.id);
      const records = await memberships(profile.id);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ role: "ssc-session" });
      expect(
        await resolveSscAccessActor({
          currentRole: records[0].role,
          organizationId,
          userId: profile.id,
        }),
      ).toEqual({ organizationId, userId: profile.id });
      const [googleAccount] = await db.select().from(account).where(eq(account.userId, profile.id));
      expect(googleAccount.providerId).toBe("google");
      const [savedProfile] = await db.select().from(user).where(eq(user.id, profile.id));
      expect(savedProfile.name).toBe("Verified Google name");
      expect(savedProfile.lastActiveAt).toBeInstanceOf(Date);
    });

    it("keeps a disabled workspace identity disabled when Google creates a later session", async () => {
      const { context, profile } = await createVerifiedGoogleIdentity();
      await db.insert(member).values({
        id: randomUUID(),
        organizationId,
        role: "noAccess",
        userId: profile.id,
      });
      await context.internalAdapter.createSession(profile.id);
      expect(await memberships(profile.id)).toMatchObject([{ role: "noAccess" }]);
    });

    it("registers an unmatched Google identity without granting this workspace membership", async () => {
      const { context, profile } = await createVerifiedGoogleIdentity(
        `${randomUUID()}@example.com`,
      );
      await context.internalAdapter.createSession(profile.id);
      expect(await memberships(profile.id)).toEqual([]);
    });
  },
);
