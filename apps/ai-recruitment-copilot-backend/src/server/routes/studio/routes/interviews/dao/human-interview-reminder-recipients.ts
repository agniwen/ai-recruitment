import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  member,
  studioHumanInterviewExternalInterviewer,
  studioHumanInterviewMeetingInterviewer,
  studioInterviewOdcAssignment,
  user,
} from "@arc/db-schema/schema";
import {
  extractTelegramUsername,
  resolveTelegramRecipientId,
} from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/identity";
import { resolveExternalInterviewerBindings } from "./external-interviewers";
import type { InterviewerInvitePayload } from "./human-interview-meeting-access";
import type { HumanInterviewReminder } from "./human-interview-reminders";

export interface HumanInterviewReminderRecipient {
  chatId: string | null;
  interviewer?: Omit<InterviewerInvitePayload, "exp" | "meetingId">;
  key: string;
  roles: string[];
}

export function mergeReminderRecipients(recipients: HumanInterviewReminderRecipient[]) {
  const merged = new Map<string, HumanInterviewReminderRecipient>();
  for (const recipient of recipients) {
    const key = recipient.chatId ? `chat:${recipient.chatId}` : recipient.key;
    const existing = merged.get(key);
    merged.set(key, {
      ...recipient,
      interviewer: existing?.interviewer ?? recipient.interviewer,
      key,
      roles: [...new Set([...(existing?.roles ?? []), ...recipient.roles])],
    });
  }
  return [...merged.values()];
}

export async function loadHumanInterviewReminderRecipients(reminder: HumanInterviewReminder) {
  const [interviewers, assignments, external] = await Promise.all([
    db
      .select({
        role: studioHumanInterviewMeetingInterviewer.role,
        userId: studioHumanInterviewMeetingInterviewer.userId,
      })
      .from(studioHumanInterviewMeetingInterviewer)
      .where(eq(studioHumanInterviewMeetingInterviewer.meetingId, reminder.meetingId)),
    db
      .select({ userId: studioInterviewOdcAssignment.userId })
      .from(studioInterviewOdcAssignment)
      .where(eq(studioInterviewOdcAssignment.interviewRecordId, reminder.candidateId)),
    db
      .select()
      .from(studioHumanInterviewExternalInterviewer)
      .where(eq(studioHumanInterviewExternalInterviewer.roundId, reminder.roundId)),
  ]);
  const odcIds = new Set(assignments.map((row) => row.userId));
  if (reminder.assignedOdcUserId) {
    odcIds.add(reminder.assignedOdcUserId);
  }
  const userIds = [
    ...new Set(
      [reminder.creatorId, ...odcIds, ...interviewers.map((row) => row.userId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const profiles = userIds.length
    ? await db
        .select({
          id: user.id,
          telegram: user.telegram,
          telegramBoundUsername: user.telegramBoundUsername,
          telegramChatId: user.telegramChatId,
        })
        .from(user)
        .innerJoin(
          member,
          and(eq(member.userId, user.id), eq(member.organizationId, reminder.organizationId)),
        )
        .where(inArray(user.id, userIds))
        .orderBy(asc(user.id))
    : [];
  // Match the existing recruitment notification rule: only an unambiguous workspace contact.
  const username = extractTelegramUsername(reminder.resumeContact);
  const contacts = username
    ? await db
        .select({
          id: user.id,
          telegram: user.telegram,
          telegramBoundUsername: user.telegramBoundUsername,
          telegramChatId: user.telegramChatId,
        })
        .from(user)
        .innerJoin(
          member,
          and(eq(member.userId, user.id), eq(member.organizationId, reminder.organizationId)),
        )
        .where(eq(sql<string>`lower(trim(leading '@' from ${user.telegram}))`, username))
        .limit(2)
    : [];
  const contact = contacts.length === 1 ? contacts[0] : undefined;
  if (contact && !profiles.some((profile) => profile.id === contact.id)) {
    profiles.push(contact);
  }
  const recipients: HumanInterviewReminderRecipient[] = profiles.map((profile) => {
    const interviewer = interviewers.find((item) => item.userId === profile.id);
    const roles: string[] = [];
    if (profile.id === reminder.creatorId || profile.id === contact?.id) {
      roles.push("招聘人员");
    }
    if (interviewer) {
      roles.push("面试官");
    }
    if (odcIds.has(profile.id)) {
      roles.push("分配 ODC");
    }
    return {
      chatId: resolveTelegramRecipientId({
        boundUsername: profile.telegramBoundUsername,
        chatId: profile.telegramChatId,
        profileTelegram: profile.telegram,
      }),
      interviewer: interviewer ? { role: interviewer.role, userId: profile.id } : undefined,
      key: `user:${profile.id}`,
      roles,
    };
  });
  const externalBindings = await resolveExternalInterviewerBindings(
    reminder.organizationId,
    external,
  );
  for (const [index, binding] of externalBindings.entries()) {
    recipients.push({
      chatId: binding.chatId,
      interviewer: { external: true, role: "interviewer", userId: external[index].id },
      key: `external:${external[index].id}`,
      roles: ["面试官"],
    });
  }
  return mergeReminderRecipients(recipients);
}
