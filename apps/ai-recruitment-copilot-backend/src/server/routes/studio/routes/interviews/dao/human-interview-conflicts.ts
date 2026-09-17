import { and, asc, eq, gt, inArray, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  studioHumanInterviewMeeting,
  studioHumanInterviewMeetingInterviewer,
  studioHumanInterviewMeetingRound,
  studioHumanInterviewRound,
  studioHumanInterviewRoundInterviewer,
  user,
} from "@arc/db-schema/schema";
import type {
  HumanInterviewConflict,
  HumanInterviewConflictInput,
} from "@arc/shared/human-interview-conflicts";
import { assertWorkspaceInterviewers } from "./human-interview-interviewers";
import {
  HumanInterviewMeetingError,
  resolveValidUntilInput,
} from "./human-interview-meeting-access";
import { humanEndAt, humanStartAt } from "./human-interview-time-range";

export async function findHumanInterviewConflicts({
  organizationId,
  input,
}: {
  organizationId: string;
  input: HumanInterviewConflictInput;
}): Promise<HumanInterviewConflict[]> {
  await assertWorkspaceInterviewers({
    makeError: (message) => new HumanInterviewMeetingError(message, 400),
    organizationId,
    userIds: input.interviewerIds,
  });
  const start = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const end = resolveValidUntilInput({ scheduledAt: start, validUntil: input.validUntil });
  if (!start || !end) {
    return [];
  }
  const selectedFields = {
    endAt: humanEndAt,
    interviewerId: user.id,
    interviewerName: user.name,
    startAt: humanStartAt,
  };
  const overlap = and(
    eq(studioHumanInterviewRound.organizationId, organizationId),
    ne(studioHumanInterviewRound.status, "cancelled"),
    input.excludeRoundIds?.length
      ? notInArray(studioHumanInterviewRound.id, input.excludeRoundIds)
      : undefined,
    inArray(user.id, input.interviewerIds),
    gt(humanEndAt, sql`${start.toISOString()}::timestamptz`),
    lt(humanStartAt, sql`${end.toISOString()}::timestamptz`),
  );
  // Check the interviewer's organization-wide availability, independently of
  // which candidates the scheduling user can read. No candidate data is returned.
  const [meetings, standaloneRounds] = await Promise.all([
    db
      .selectDistinct(selectedFields)
      .from(studioHumanInterviewRound)
      .innerJoin(
        studioHumanInterviewMeetingRound,
        eq(studioHumanInterviewMeetingRound.roundId, studioHumanInterviewRound.id),
      )
      .innerJoin(
        studioHumanInterviewMeeting,
        eq(studioHumanInterviewMeeting.id, studioHumanInterviewMeetingRound.meetingId),
      )
      .innerJoin(
        studioHumanInterviewMeetingInterviewer,
        eq(studioHumanInterviewMeetingInterviewer.meetingId, studioHumanInterviewMeeting.id),
      )
      .innerJoin(user, eq(user.id, studioHumanInterviewMeetingInterviewer.userId))
      .where(
        and(
          overlap,
          eq(studioHumanInterviewMeeting.organizationId, organizationId),
          ne(studioHumanInterviewMeeting.status, "cancelled"),
        ),
      )
      .orderBy(asc(user.id), asc(humanStartAt)),
    db
      .selectDistinct(selectedFields)
      .from(studioHumanInterviewRound)
      .leftJoin(
        studioHumanInterviewMeetingRound,
        eq(studioHumanInterviewMeetingRound.roundId, studioHumanInterviewRound.id),
      )
      .leftJoin(
        studioHumanInterviewMeeting,
        eq(studioHumanInterviewMeeting.id, studioHumanInterviewMeetingRound.meetingId),
      )
      .innerJoin(
        studioHumanInterviewRoundInterviewer,
        eq(studioHumanInterviewRoundInterviewer.roundId, studioHumanInterviewRound.id),
      )
      .innerJoin(user, eq(user.id, studioHumanInterviewRoundInterviewer.userId))
      .where(and(overlap, isNull(studioHumanInterviewMeetingRound.roundId)))
      .orderBy(asc(user.id), asc(humanStartAt)),
  ]);
  const conflicts = new Map<string, HumanInterviewConflict>();
  for (const row of [...meetings, ...standaloneRounds]) {
    const startAt = row.startAt.toISOString();
    const endAt = row.endAt.toISOString();
    conflicts.set(`${row.interviewerId}:${startAt}:${endAt}`, {
      endAt,
      interviewerId: row.interviewerId,
      interviewerName: row.interviewerName ?? "未命名",
      startAt,
    });
  }
  return [...conflicts.values()];
}
