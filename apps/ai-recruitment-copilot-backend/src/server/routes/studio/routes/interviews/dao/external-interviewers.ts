import type { InterviewerInvitePayload } from "./human-interview-meeting-access";
import type { HumanInterviewMeetingInterviewerInviteScope } from "./human-interview-meetings";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  studioInterview,
  studioHumanInterviewExternalInterviewer,
  studioHumanInterviewMeeting,
  studioHumanInterviewMeetingRound,
  telegramRequesterBinding,
} from "@arc/db-schema/schema";
import type { ExternalInterviewerInput } from "@arc/db-schema/studio-interviews";
import {
  externalInterviewerUsername,
  parseRequesterInterviewers,
} from "@arc/shared/external-interviewers";

export async function loadExternalInterviewerDefaults(candidateId: string, organizationId: string) {
  const [row] = await db
    .select({ requester: jobDescription.requester })
    .from(studioInterview)
    .leftJoin(
      jobDescription,
      and(
        eq(studioInterview.jobDescriptionId, jobDescription.id),
        eq(jobDescription.organizationId, organizationId),
      ),
    )
    .where(
      and(eq(studioInterview.id, candidateId), eq(studioInterview.organizationId, organizationId)),
    )
    .limit(1);
  return row ? parseRequesterInterviewers(row.requester) : null;
}

export async function resolveExternalInterviewerBindings(
  organizationId: string,
  interviewers: ExternalInterviewerInput[],
) {
  const usernames = [
    ...new Set(
      interviewers
        .map((item) => externalInterviewerUsername(item.telegram))
        .filter((item): item is string => item !== null),
    ),
  ];
  const rows = usernames.length
    ? await db
        .select({
          chatId: telegramRequesterBinding.chatId,
          username: telegramRequesterBinding.username,
        })
        .from(telegramRequesterBinding)
        .where(
          and(
            eq(telegramRequesterBinding.organizationId, organizationId),
            inArray(telegramRequesterBinding.username, usernames),
          ),
        )
    : [];
  const recipients = new Map(rows.map((row) => [row.username, row.chatId]));
  return interviewers.map((item) => ({
    ...item,
    chatId: recipients.get(externalInterviewerUsername(item.telegram) ?? "") ?? null,
  }));
}

export function listExternalMeetingInterviewers(meetingIds: string[]) {
  if (!meetingIds.length) {
    return [];
  }
  return db
    .select({
      id: studioHumanInterviewExternalInterviewer.id,
      joinedAt: studioHumanInterviewExternalInterviewer.joinedAt,
      leftAt: studioHumanInterviewExternalInterviewer.leftAt,
      meetingId: studioHumanInterviewMeeting.id,
      name: studioHumanInterviewExternalInterviewer.name,
      telegram: studioHumanInterviewExternalInterviewer.telegram,
    })
    .from(studioHumanInterviewExternalInterviewer)
    .innerJoin(
      studioHumanInterviewMeetingRound,
      eq(studioHumanInterviewExternalInterviewer.roundId, studioHumanInterviewMeetingRound.roundId),
    )
    .innerJoin(
      studioHumanInterviewMeeting,
      eq(studioHumanInterviewMeetingRound.meetingId, studioHumanInterviewMeeting.id),
    )
    .where(inArray(studioHumanInterviewMeeting.id, meetingIds));
}

export async function resolveExternalInterviewerInvite(
  payload: InterviewerInvitePayload,
): Promise<HumanInterviewMeetingInterviewerInviteScope | null> {
  const [row] = await db
    .select({
      interviewerName: studioHumanInterviewExternalInterviewer.name,
      liveKitRoomName: studioHumanInterviewMeeting.liveKitRoomName,
      meetingId: studioHumanInterviewMeeting.id,
      organizationId: studioHumanInterviewMeeting.organizationId,
      scheduledAt: studioHumanInterviewMeeting.scheduledAt,
      status: studioHumanInterviewMeeting.status,
      title: studioHumanInterviewMeeting.title,
      validUntil: studioHumanInterviewMeeting.validUntil,
    })
    .from(studioHumanInterviewExternalInterviewer)
    .innerJoin(
      studioHumanInterviewMeetingRound,
      eq(studioHumanInterviewExternalInterviewer.roundId, studioHumanInterviewMeetingRound.roundId),
    )
    .innerJoin(
      studioHumanInterviewMeeting,
      eq(studioHumanInterviewMeetingRound.meetingId, studioHumanInterviewMeeting.id),
    )
    .where(
      and(
        eq(studioHumanInterviewExternalInterviewer.id, payload.userId),
        eq(studioHumanInterviewMeeting.id, payload.meetingId),
      ),
    )
    .limit(1);
  if (!row || payload.role !== "interviewer") {
    return null;
  }
  return {
    ...row,
    role: "interviewer",
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    userId: `external_${payload.userId}`,
    validUntil: row.validUntil?.toISOString() ?? null,
  };
}

export async function markExternalInterviewerAttendance(
  meetingId: string,
  id: string,
  update: { joinedAt?: Date; leftAt?: Date },
) {
  const participants = await listExternalMeetingInterviewers([meetingId]);
  if (participants.some((item) => item.id === id)) {
    await db
      .update(studioHumanInterviewExternalInterviewer)
      .set(update)
      .where(eq(studioHumanInterviewExternalInterviewer.id, id));
  }
}
