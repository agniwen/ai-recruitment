import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  organization,
  studioHumanInterviewMeeting as meeting,
  studioHumanInterviewMeetingRound as meetingRound,
  studioHumanInterviewRound as round,
  studioInterview as candidate,
  studioHumanInterviewReminderSchedule as schedule,
} from "@arc/db-schema/schema";

import type { HumanInterviewReminderJob } from "@arc/resume-parse-queue/human-interview-reminders";

export const HUMAN_INTERVIEW_REMINDER_LEAD_MS = 10 * 60 * 1000;

const scheduledTime = meeting.scheduledAt;

export async function loadHumanInterviewReminderRounds(job: HumanInterviewReminderJob, now: Date) {
  const rows = await db
    .select({
      assignedOdcUserId: candidate.aiReviewAssignedOdcUserId,
      candidateId: candidate.id,
      candidateName: candidate.candidateName,
      creatorId: candidate.createdBy,
      format: round.format,
      jobName: jobDescription.name,
      location: round.location,
      meetingId: meeting.id,
      organizationId: round.organizationId,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      resumeContact: jobDescription.resumeContact,
      revision: schedule.revision,
      roundId: round.id,
      scheduledAt: sql<string>`${scheduledTime}::text`,
      title: round.label,
    })
    .from(round)
    .innerJoin(
      candidate,
      and(
        eq(round.interviewRecordId, candidate.id),
        eq(round.organizationId, candidate.organizationId),
      ),
    )
    .innerJoin(organization, eq(round.organizationId, organization.id))
    .leftJoin(
      jobDescription,
      and(
        eq(candidate.jobDescriptionId, jobDescription.id),
        eq(jobDescription.organizationId, round.organizationId),
      ),
    )
    .innerJoin(meetingRound, eq(meetingRound.roundId, round.id))
    .innerJoin(meeting, eq(meeting.id, meetingRound.meetingId))
    .innerJoin(schedule, eq(schedule.meetingId, meeting.id))
    .where(
      and(
        eq(meeting.id, job.meetingId),
        eq(schedule.revision, job.revision),
        eq(schedule.active, true),
        eq(round.status, "pending"),
        eq(candidate.pipelineStage, "human_interview"),
        eq(candidate.outcome, "in_pipeline"),
        eq(meeting.organizationId, round.organizationId),
        inArray(meeting.status, ["scheduled", "in_progress"]),
        // Early room entry sets in_progress; other participants still need the reminder.
        or(isNull(meeting.validUntil), gt(meeting.validUntil, now)),
        sql`${scheduledTime} > ${now.toISOString()}::timestamptz`,
        sql`${scheduledTime} <= ${new Date(now.getTime() + HUMAN_INTERVIEW_REMINDER_LEAD_MS).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(scheduledTime), asc(round.id));
  return rows.map((row) => ({ ...row, scheduledAt: new Date(row.scheduledAt) }));
}

export type HumanInterviewReminder = Awaited<
  ReturnType<typeof loadHumanInterviewReminderRounds>
>[number];
