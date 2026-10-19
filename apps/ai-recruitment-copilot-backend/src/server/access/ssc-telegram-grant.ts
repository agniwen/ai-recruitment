import { and, eq, exists, ne, notExists, notInArray, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  organizationRole,
  resumeSource,
  sscResponsibility,
  sscTelegramIdentity,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";

/** A ledger handle grants access only while the pinned numeric account still owns it. */
export function verifiedSscTelegramGrant(telegram: SQLWrapper, userId: SQLWrapper | string) {
  const pin = alias(sscTelegramIdentity, "ssc_grant_pin");
  const binding = alias(telegramRecipientBinding, "ssc_grant_follower");
  const profile = alias(user, "ssc_grant_profile");
  const otherProfile = alias(user, "ssc_grant_other_profile");
  const assignment = alias(sscResponsibility, "ssc_grant_assignment");
  const source = alias(resumeSource, "ssc_grant_source");
  const role = alias(organizationRole, "ssc_grant_role");
  const emailOwner = alias(user, "ssc_grant_email_owner");
  return exists(
    db
      .select({ value: sql`1` })
      .from(pin)
      .innerJoin(binding, and(eq(binding.chatId, pin.chatId), eq(binding.username, pin.username)))
      .innerJoin(profile, eq(profile.id, pin.userId))
      .where(
        and(
          eq(pin.userId, userId),
          sql`lower(btrim(trim(leading '@' from btrim(${telegram})))) = ${pin.username}`,
          sql`(nullif(btrim(${profile.telegramChatId}), '') IS NULL OR ${profile.telegramChatId} = ${pin.chatId})`,
          sql`(nullif(btrim(${profile.telegramBoundUsername}), '') IS NULL OR lower(btrim(${profile.telegramBoundUsername})) = ${pin.username})`,
          sql`(nullif(btrim(${profile.telegram}), '') IS NULL OR lower(btrim(trim(leading '@' from btrim(${profile.telegram})))) = ${pin.username})`,
          notExists(
            db
              .select({ value: sql`1` })
              .from(assignment)
              .innerJoin(
                source,
                and(
                  eq(source.id, assignment.resumeSourceId),
                  eq(source.organizationId, assignment.organizationId),
                ),
              )
              .innerJoin(
                role,
                and(
                  eq(role.organizationId, assignment.organizationId),
                  eq(role.role, assignment.workspaceRole),
                  eq(role.isSsc, true),
                  eq(role.isOdc, false),
                ),
              )
              .innerJoin(
                emailOwner,
                sql`lower(btrim(${emailOwner.email})) = lower(btrim(${assignment.email}))`,
              )
              .where(
                and(
                  sql`lower(btrim(trim(leading '@' from btrim(${assignment.telegram})))) = ${pin.username}`,
                  sql`btrim(${assignment.email}) <> ''`,
                  notInArray(role.role, ["owner", "admin", "member", "noAccess"]),
                  ne(emailOwner.id, pin.userId),
                ),
              ),
          ),
          notExists(
            db
              .select({ value: sql`1` })
              .from(otherProfile)
              .where(
                and(
                  ne(otherProfile.id, pin.userId),
                  or(
                    eq(otherProfile.telegramChatId, pin.chatId),
                    sql`lower(btrim(${otherProfile.telegramBoundUsername})) = ${pin.username}`,
                    sql`lower(btrim(trim(leading '@' from btrim(${otherProfile.telegram})))) = ${pin.username}`,
                  ),
                ),
              ),
          ),
        ),
      ),
  );
}
