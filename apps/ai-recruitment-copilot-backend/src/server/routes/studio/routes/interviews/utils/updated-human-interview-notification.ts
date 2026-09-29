import type { HumanInterviewRoundRecord } from "@arc/shared/studio-pipeline-stages";
import { listHumanInterviewMeetings } from "../dao/human-interview-meetings";
import { notifyExternalInterviewers } from "./external-interviewer-notification";

export async function notifyUpdatedHumanInterviewRound(
  round: HumanInterviewRoundRecord,
): Promise<string[]> {
  if (round.status !== "pending") {
    return [];
  }
  try {
    const meetings = await listHumanInterviewMeetings({
      interviewRecordId: round.interviewRecordId,
      organizationId: round.organizationId,
    });
    const failures = await Promise.all(
      meetings
        .filter(
          (meeting) =>
            meeting.status === "scheduled" &&
            meeting.rounds.some((item) => item.roundId === round.id),
        )
        .map((meeting) => notifyExternalInterviewers(meeting, "updated")),
    );
    return [...new Set(failures.flat())];
  } catch {
    // Saving has committed; report delivery failure without making the user save again.
    return ["面试官通知发送异常"];
  }
}
