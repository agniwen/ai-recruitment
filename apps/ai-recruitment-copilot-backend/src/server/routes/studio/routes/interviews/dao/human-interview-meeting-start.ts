import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  studioHumanInterviewMeeting,
  studioHumanInterviewMeetingRound,
  studioHumanInterviewRound,
} from "@arc/db-schema/schema";

export async function markHumanInterviewMeetingInProgressByRoomName(
  roomName: string,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const meetings = await tx
      .update(studioHumanInterviewMeeting)
      .set({ startedAt: now, status: "in_progress", updatedAt: now })
      .where(
        and(
          eq(studioHumanInterviewMeeting.liveKitRoomName, roomName),
          eq(studioHumanInterviewMeeting.status, "scheduled"),
        ),
      )
      .returning({ id: studioHumanInterviewMeeting.id });
    if (meetings.length === 0) {
      return;
    }
    const roundRows = await tx
      .select({ id: studioHumanInterviewMeetingRound.roundId })
      .from(studioHumanInterviewMeetingRound)
      .where(
        inArray(
          studioHumanInterviewMeetingRound.meetingId,
          meetings.map((meeting) => meeting.id),
        ),
      );
    if (roundRows.length === 0) {
      return;
    }
    await tx
      .update(studioHumanInterviewRound)
      .set({ startedAt: now, updatedAt: now })
      .where(
        and(
          inArray(
            studioHumanInterviewRound.id,
            roundRows.map((round) => round.id),
          ),
          eq(studioHumanInterviewRound.status, "pending"),
          isNull(studioHumanInterviewRound.startedAt),
        ),
      );
  });
}
