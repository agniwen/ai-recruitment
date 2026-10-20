import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { acquireSscProvisioningLock } from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import {
  member,
  organizationRole,
  resumeSource,
  sscResponsibility,
  sscTelegramIdentity,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import { normalizeTelegramUsername } from "./utils/identity";
import { pinSscTelegramIdentity } from "./ssc-telegram-binding";

class IdentityConflictError extends Error {
  override name = "IdentityConflictError";
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function hasConflictingPersonalIdentity(
  profile: typeof user.$inferSelect,
  input: { chatId: string; username: string },
) {
  return Boolean(
    profile.banned ||
    (profile.telegram?.trim() && normalizeTelegramUsername(profile.telegram) !== input.username) ||
    (profile.telegramBoundUsername &&
      normalizeTelegramUsername(profile.telegramBoundUsername) !== input.username) ||
    (profile.telegramChatId && profile.telegramChatId !== input.chatId),
  );
}

async function loadFollowerIdentity(
  tx: Transaction,
  input: { chatId: string; username: string },
  emails: string[],
) {
  const { username } = input;
  const pins = await tx
    .select()
    .from(sscTelegramIdentity)
    .where(
      or(eq(sscTelegramIdentity.chatId, input.chatId), eq(sscTelegramIdentity.username, username)),
    );
  if (
    pins.length > 1 ||
    pins.some((row) => row.chatId !== input.chatId || row.username !== username)
  ) {
    return null;
  }
  const emailProfiles = emails.length
    ? await tx
        .select()
        .from(user)
        .where(inArray(sql<string>`lower(btrim(${user.email}))`, emails))
    : [];
  const linked = await tx
    .select()
    .from(user)
    .where(
      or(
        eq(user.telegramChatId, input.chatId),
        sql`lower(btrim(${user.telegramBoundUsername})) = ${username}`,
        sql`lower(btrim(trim(leading '@' from btrim(${user.telegram})))) = ${username}`,
      ),
    );
  const ids = new Set([...emailProfiles.map((row) => row.id), ...pins.map((row) => row.userId)]);
  const verified = linked.filter(
    (row) =>
      row.telegramChatId === input.chatId &&
      normalizeTelegramUsername(row.telegramBoundUsername) === username,
  );
  for (const row of verified) {
    ids.add(row.id);
  }
  if (ids.size > 1) {
    return null;
  }
  const [id] = ids;
  if (linked.some((row) => row.id !== id)) {
    return null;
  }
  const profiles = id ? await tx.select().from(user).where(eq(user.id, id)) : [];
  const [profile] = profiles;
  if ((id && !profile) || (profile && hasConflictingPersonalIdentity(profile, input))) {
    return null;
  }
  return { profile };
}

/** Reuses a verified follower; creates an audit-only identity if no system account exists. */
export async function provisionSscTelegramFollower(input: { chatId: string; username: string }) {
  const username = normalizeTelegramUsername(input.username);
  if (!username || !/^[a-zA-Z0-9_]{5,32}$/u.test(username) || !/^[1-9]\d*$/u.test(input.chatId)) {
    return null;
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ssc-telegram:${username}`}, 0))`,
      );
      const [followed] = await tx
        .select()
        .from(telegramRecipientBinding)
        .where(
          and(
            eq(telegramRecipientBinding.chatId, input.chatId),
            eq(telegramRecipientBinding.username, username),
          ),
        );
      if (!followed) {
        return null;
      }
      const assignments = await tx
        .select({
          email: sscResponsibility.email,
          name: sscResponsibility.sscName,
          organizationId: sscResponsibility.organizationId,
          role: sscResponsibility.workspaceRole,
        })
        .from(sscResponsibility)
        .innerJoin(
          resumeSource,
          and(
            eq(resumeSource.id, sscResponsibility.resumeSourceId),
            eq(resumeSource.organizationId, sscResponsibility.organizationId),
          ),
        )
        .innerJoin(
          organizationRole,
          and(
            eq(organizationRole.organizationId, sscResponsibility.organizationId),
            eq(organizationRole.role, sscResponsibility.workspaceRole),
            eq(organizationRole.isSsc, true),
            eq(organizationRole.isOdc, false),
          ),
        )
        .where(
          sql`lower(btrim(trim(leading '@' from btrim(${sscResponsibility.telegram})))) = ${username}`,
        );
      const grants = assignments.filter(
        (row): row is typeof row & { role: string } =>
          Boolean(row.role) && !["owner", "admin", "member", "noAccess"].includes(row.role ?? ""),
      );
      if (!grants.length) {
        return null;
      }
      const emails = [
        ...new Set(grants.map((row) => row.email.trim().toLowerCase()).filter(Boolean)),
      ];
      const identity = await loadFollowerIdentity(tx, { ...input, username }, emails);
      if (!identity) {
        return null;
      }
      let { profile } = identity;
      if (!profile) {
        const userId = randomUUID();
        [profile] = await tx
          .insert(user)
          .values({
            email: `ssc-tg-${userId}@telegram.invalid`,
            emailVerified: false,
            id: userId,
            name: grants.find((row) => row.name.trim())?.name || username,
          })
          .returning();
      }
      if (
        !profile ||
        !(await pinSscTelegramIdentity({ ...input, userId: profile.id, username }, tx))
      ) {
        throw new IdentityConflictError();
      }
      const scopes = new Map<string, Set<string>>();
      for (const grant of grants) {
        const roles = scopes.get(grant.organizationId) ?? new Set<string>();
        roles.add(grant.role);
        scopes.set(grant.organizationId, roles);
      }
      for (const [organizationId, roles] of [...scopes.entries()].toSorted(([a], [b]) =>
        a.localeCompare(b),
      )) {
        if (roles.size !== 1) {
          continue;
        }
        await acquireSscProvisioningLock(tx, organizationId);
        const [existing] = await tx
          .select()
          .from(member)
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, profile.id)))
          .for("update");
        if (!existing) {
          await tx
            .insert(member)
            .values({
              id: `mem_${randomUUID()}`,
              organizationId,
              role: [...roles][0],
              userId: profile.id,
            })
            .onConflictDoNothing({ target: [member.userId, member.organizationId] });
        }
      }
      return { name: profile.name, userId: profile.id };
    });
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      return null;
    }
    throw error;
  }
}
