import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  member,
  organizationRole,
  resumeSource,
  sscResponsibility,
  studioInterview,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import { normalizeTelegramUsername } from "./utils/identity";
import { pinSscTelegramIdentity } from "./ssc-telegram-binding";

interface RecipientFilter {
  chatId?: string;
  interviewRecordId?: string;
  organizationId?: string;
  usernames?: string[];
}

async function loadSscRecipients(filter: RecipientFilter) {
  const candidateSource = filter.interviewRecordId
    ? exists(
        db
          .select({ id: studioInterview.id })
          .from(studioInterview)
          .innerJoin(
            jobDescription,
            and(
              eq(jobDescription.id, studioInterview.jobDescriptionId),
              eq(jobDescription.organizationId, studioInterview.organizationId),
            ),
          )
          .where(
            and(
              eq(studioInterview.id, filter.interviewRecordId),
              eq(studioInterview.organizationId, sscResponsibility.organizationId),
              eq(jobDescription.resumeSourceId, sscResponsibility.resumeSourceId),
            ),
          ),
      )
    : undefined;
  const rows = await db
    .select({
      banned: user.banned,
      chatId: telegramRecipientBinding.chatId,
      email: user.email,
      organizationId: member.organizationId,
      profileTelegram: user.telegram,
      profileTelegramBoundUsername: user.telegramBoundUsername,
      profileTelegramChatId: user.telegramChatId,
      telegram: sscResponsibility.telegram,
      userId: user.id,
      username: telegramRecipientBinding.username,
    })
    .from(sscResponsibility)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, sscResponsibility.organizationId),
        eq(member.role, sscResponsibility.workspaceRole),
      ),
    )
    .innerJoin(
      user,
      and(
        eq(user.id, member.userId),
        sql`lower(btrim(${user.email})) = lower(btrim(${sscResponsibility.email}))`,
      ),
    )
    .innerJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
        eq(organizationRole.isSsc, true),
        eq(organizationRole.isOdc, false),
      ),
    )
    .innerJoin(
      resumeSource,
      and(
        eq(resumeSource.organizationId, sscResponsibility.organizationId),
        eq(resumeSource.id, sscResponsibility.resumeSourceId),
      ),
    )
    .innerJoin(
      telegramRecipientBinding,
      sql`lower(btrim(trim(leading '@' from btrim(${sscResponsibility.telegram})))) = ${telegramRecipientBinding.username}`,
    )
    .where(
      and(
        eq(user.banned, false),
        filter.organizationId ? eq(member.organizationId, filter.organizationId) : undefined,
        filter.chatId ? eq(telegramRecipientBinding.chatId, filter.chatId) : undefined,
        filter.usernames ? inArray(telegramRecipientBinding.username, filter.usernames) : undefined,
        candidateSource,
      ),
    );
  if (!rows.length) {
    return [];
  }
  const emails = [...new Set(rows.map((row) => row.email.trim().toLowerCase()))];
  const profiles = await db
    .select({ email: user.email, id: user.id })
    .from(user)
    .where(inArray(sql<string>`lower(btrim(${user.email}))`, emails));
  const usernames = [...new Set(rows.map((row) => row.username))];
  const chatIds = [...new Set(rows.map((row) => row.chatId))];
  const linkedProfiles = await db
    .select({
      bound: user.telegramBoundUsername,
      chatId: user.telegramChatId,
      id: user.id,
      telegram: user.telegram,
    })
    .from(user)
    .where(
      or(
        inArray(user.telegramChatId, chatIds),
        inArray(sql<string>`lower(btrim(${user.telegramBoundUsername}))`, usernames),
        inArray(
          sql<string>`lower(btrim(trim(leading '@' from btrim(${user.telegram}))))`,
          usernames,
        ),
      ),
    );
  const identities = new Map<string, Set<string>>();
  for (const profile of profiles) {
    const email = profile.email.trim().toLowerCase();
    const ids = identities.get(email) ?? new Set<string>();
    ids.add(profile.id);
    identities.set(email, ids);
  }
  return rows.filter((row) => {
    const username = normalizeTelegramUsername(row.telegram);
    return Boolean(
      username &&
      /^[a-zA-Z0-9_]{5,32}$/u.test(username) &&
      username === row.username &&
      /^[1-9]\d*$/u.test(row.chatId) &&
      identities.get(row.email.trim().toLowerCase())?.size === 1 &&
      !linkedProfiles.some(
        (profile) =>
          profile.id !== row.userId &&
          (profile.chatId === row.chatId ||
            normalizeTelegramUsername(profile.telegram) === username ||
            normalizeTelegramUsername(profile.bound) === username),
      ) &&
      (!row.profileTelegram?.trim() ||
        normalizeTelegramUsername(row.profileTelegram) === username) &&
      (!row.profileTelegramBoundUsername ||
        normalizeTelegramUsername(row.profileTelegramBoundUsername) === username) &&
      (!row.profileTelegramChatId || row.profileTelegramChatId === row.chatId),
    );
  });
}

/** SSC ledger handles become approval identities only after a verified private /start. */
export async function resolveLedgerTelegramOfferActor(input: {
  telegramUserId: string;
  username: string;
}) {
  const rows = await loadSscRecipients({
    chatId: input.telegramUserId,
    usernames: [input.username],
  });
  const ids = new Set(rows.map((row) => row.userId));
  const userId = ids.size === 1 ? [...ids][0] : undefined;
  return userId &&
    (await pinSscTelegramIdentity({
      chatId: input.telegramUserId,
      userId,
      username: input.username,
    }))
    ? userId
    : null;
}

export async function listSourceSscTelegramRecipients(input: {
  organizationId: string;
  interviewRecordId: string;
}) {
  const rows = await loadSscRecipients(input);
  const names = [...new Set(rows.flatMap((row) => (row.username ? [row.username] : [])))];
  if (!names.length) {
    return [];
  }
  // A shared handle must not leak an Offer to one of several conflicting people,
  // even when the other assignment is in a different workspace or source.
  const all = await loadSscRecipients({ usernames: names });
  const idsByChat = new Map<string, Set<string>>();
  for (const row of all) {
    const ids = idsByChat.get(row.chatId) ?? new Set<string>();
    ids.add(row.userId);
    idsByChat.set(row.chatId, ids);
  }
  const seen = new Set<string>();
  const recipients = [];
  for (const row of rows) {
    if (!row.username) {
      continue;
    }
    if (idsByChat.get(row.chatId)?.size !== 1 || seen.has(row.userId)) {
      continue;
    }
    if (
      !(await pinSscTelegramIdentity({
        chatId: row.chatId,
        userId: row.userId,
        username: row.username,
      }))
    ) {
      continue;
    }
    seen.add(row.userId);
    recipients.push({
      banned: row.banned,
      organizationId: row.organizationId,
      telegram: row.telegram,
      telegramBoundUsername: row.username,
      telegramChatId: row.chatId,
      userId: row.userId,
    });
  }
  return recipients;
}
