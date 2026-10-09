import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewTelemetryEvent, studioHumanInterviewMeeting } from "@arc/db-schema/schema";
import type { InterviewClientEvent, InterviewTrace } from "@arc/shared/interview-telemetry";
import {
  resolveHumanInterviewMeetingInviteToken,
  resolveHumanInterviewMeetingInterviewerInviteToken,
} from "../../../studio/routes/interviews/dao/human-interview-meetings";
import { requestEvidence, readInterviewTrace } from "./utils";

export interface TelemetryScope {
  meetingId: string;
  organizationId: string;
  meetingTitle: string;
  roomName: string | null;
  participantIdentity: string;
  participantName: string | null;
  participantRole: string;
}

export async function resolveTelemetryScope(
  mode: "candidate" | "interviewer",
  token: string,
): Promise<TelemetryScope | null> {
  if (mode === "candidate") {
    const scope = await resolveHumanInterviewMeetingInviteToken(token);
    return scope
      ? {
          meetingId: scope.meetingId,
          meetingTitle: scope.title,
          organizationId: scope.organizationId,
          participantIdentity: `candidate_${scope.roundId}`,
          participantName: scope.candidateName,
          participantRole: "candidate",
          roomName: scope.liveKitRoomName,
        }
      : null;
  }
  const scope = await resolveHumanInterviewMeetingInterviewerInviteToken(token);
  return scope
    ? {
        meetingId: scope.meetingId,
        meetingTitle: scope.title,
        organizationId: scope.organizationId,
        participantIdentity: `interviewer_${scope.userId}`,
        participantName: scope.interviewerName,
        participantRole: scope.role,
        roomName: scope.liveKitRoomName,
      }
    : null;
}

export async function saveClientEvents(
  scope: TelemetryScope,
  events: InterviewClientEvent[],
  headers: Headers,
) {
  const evidence = requestEvidence(headers);
  // Late disconnect/page-exit reports remain accepted after meeting end, while invite is valid.
  await db
    .insert(interviewTelemetryEvent)
    .values(
      events.map(({ id, occurredAt, ...event }) => ({
        ...scope,
        ...evidence,
        ...event,
        eventKey: id,
        id: randomUUID(),
        occurredAt: new Date(occurredAt),
        source: "client",
      })),
    )
    .onConflictDoNothing();
}

export async function recordServerTelemetry(input: {
  roomName: string | null;
  type: string;
  participantIdentity?: string;
  participantName?: string;
  participantRole?: string;
  headers?: Headers;
  trace?: Partial<InterviewTrace>;
  source?: "server" | "livekit";
  eventKey?: string;
  occurredAt?: Date;
  roomSid?: string;
  participantSid?: string;
  details?: Record<string, unknown>;
}) {
  if (!input.roomName) {
    return;
  }
  const [meeting] = await db
    .select({
      meetingId: studioHumanInterviewMeeting.id,
      meetingTitle: studioHumanInterviewMeeting.title,
      organizationId: studioHumanInterviewMeeting.organizationId,
    })
    .from(studioHumanInterviewMeeting)
    .where(eq(studioHumanInterviewMeeting.liveKitRoomName, input.roomName))
    .limit(1);
  // Deleted meetings can still receive late RTC events; recover the retained scope, never recreate the meeting.
  let snapshot = meeting;
  if (!snapshot) {
    const [retained] = await db
      .select({
        meetingId: interviewTelemetryEvent.meetingId,
        meetingTitle: interviewTelemetryEvent.meetingTitle,
        organizationId: interviewTelemetryEvent.organizationId,
      })
      .from(interviewTelemetryEvent)
      .where(eq(interviewTelemetryEvent.roomName, input.roomName))
      .orderBy(desc(interviewTelemetryEvent.receivedAt))
      .limit(1);
    snapshot = retained;
  }
  if (!snapshot) {
    return;
  }
  await db
    .insert(interviewTelemetryEvent)
    .values({
      ...snapshot,
      ...(input.headers ? requestEvidence(input.headers) : {}),
      ...(input.headers ? readInterviewTrace(input.headers) : input.trace),
      details: input.details ?? {},
      eventKey: input.eventKey ?? randomUUID(),
      id: randomUUID(),
      occurredAt: input.occurredAt ?? new Date(),
      participantIdentity: input.participantIdentity ?? "",
      participantName: input.participantName,
      participantRole: input.participantRole,
      participantSid: input.participantSid,
      roomName: input.roomName,
      roomSid: input.roomSid,
      source: input.source ?? "server",
      type: input.type,
    })
    .onConflictDoNothing();
}

export async function recordServerTelemetrySafely(
  input: Parameters<typeof recordServerTelemetry>[0],
) {
  try {
    await recordServerTelemetry(input);
  } catch {
    // Never log a request, invitation, JWT or a database error containing event data.
    console.warn("interview telemetry persistence failed", {
      roomName: input.roomName,
      type: input.type,
    });
  }
}
