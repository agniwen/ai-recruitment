import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  interviewMediaAsset as asset,
  interviewMediaRoom as archive,
  interviewTelemetryEvent as event,
  studioHumanInterviewMeeting as meeting,
} from "@arc/db-schema/schema";
import type { InterviewMediaEnvironment } from "@arc/db-schema/interview-media";
import { interviewTraceSchema } from "@arc/shared/interview-telemetry";
import { mediaStorageBackend, writeMedia } from "./storage";

export const MEDIA_RECORDER_IDENTITY = "arc_interview_media_recorder";
export const MEDIA_NOTIFY_CHANNEL = "interview_media_changed";

export async function ensureMediaRoom(roomName: string, roomSid: string) {
  const [context] = await db
    .select()
    .from(meeting)
    .where(eq(meeting.liveKitRoomName, roomName))
    .limit(1);
  if (!context || ["cancelled", "ended"].includes(context.status)) {
    return null;
  }
  const [row] = await db
    .insert(archive)
    .values({
      meetingId: context.id,
      meetingTitle: context.title,
      organizationId: context.organizationId,
      roomName,
      roomSid,
    })
    .onConflictDoUpdate({ set: { meetingTitle: context.title }, target: archive.roomSid })
    .returning();
  return row;
}

export async function signalMediaRoom(roomName: string, roomSid: string, finished: boolean) {
  // Separate the terminal update from archive creation so late events cannot reopen a room.
  // oxlint-disable-next-line unicorn/prefer-ternary
  if (finished) {
    await db
      .update(archive)
      .set({ endedAt: new Date(), leaseUntil: new Date(0), status: "stopped" })
      .where(eq(archive.roomSid, roomSid));
  } else {
    await ensureMediaRoom(roomName, roomSid);
  }
  await db.execute(sql`select pg_notify(${MEDIA_NOTIFY_CHANNEL}, '')`);
}

export async function claimMediaRoom(roomSid: string, owner: string) {
  const [row] = await db
    .update(archive)
    .set({
      errorCode: null,
      heartbeatAt: new Date(),
      leaseOwner: owner,
      leaseUntil: sql`now() + interval '30 seconds'`,
      status: "capturing",
    })
    .where(
      and(
        eq(archive.roomSid, roomSid),
        isNull(archive.endedAt),
        or(isNull(archive.leaseUntil), lt(archive.leaseUntil, sql`now()`)),
      ),
    )
    .returning();
  return row;
}
function ownsLease(roomSid: string, owner: string) {
  return and(
    eq(archive.roomSid, roomSid),
    eq(archive.leaseOwner, owner),
    gt(archive.leaseUntil, sql`now()`),
    isNull(archive.endedAt),
  );
}
export async function renewMediaRoom(roomSid: string, owner: string) {
  const rows = await db
    .update(archive)
    .set({ heartbeatAt: new Date(), leaseUntil: sql`now() + interval '30 seconds'` })
    .where(ownsLease(roomSid, owner))
    .returning({ id: archive.roomSid });
  return rows.length > 0;
}
export async function releaseMediaRoom(roomSid: string, owner: string, errorCode?: string) {
  await db
    .update(archive)
    .set({
      errorCode: errorCode ?? null,
      leaseOwner: null,
      leaseUntil: null,
      status: errorCode ? "error" : "stopped",
    })
    .where(and(eq(archive.roomSid, roomSid), eq(archive.leaseOwner, owner)));
}

export interface CaptureParticipant {
  identity: string;
  sid: string;
  name: string;
  metadata: string;
}
export function parseParticipantEvidence(participant: CaptureParticipant) {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(participant.metadata);
  } catch {
    // Unknown clients have no trace.
  }
  const parsed = interviewTraceSchema.safeParse(metadata?.interview_trace);
  const trace: InterviewMediaEnvironment = parsed.success
    ? { ...parsed.data, fingerprint: parsed.data.fingerprintId }
    : {};
  return {
    environment: trace,
    role:
      typeof metadata?.participant_role === "string"
        ? metadata.participant_role.slice(0, 40)
        : "unknown",
  };
}

async function environmentSnapshot(meetingId: string, participant: CaptureParticipant) {
  const evidence = parseParticipantEvidence(participant);
  const trace = evidence.environment;
  // Match this connection's attempt/visit, never infer a device from a shared IP or identity alone.
  const connection = trace.attemptId
    ? eq(event.attemptId, trace.attemptId)
    : eq(event.participantSid, participant.sid);
  const where = and(
    eq(event.meetingId, meetingId),
    eq(event.participantIdentity, participant.identity),
  );
  const [request, fingerprint] = await Promise.all([
    db
      .select()
      .from(event)
      .where(and(where, connection, sql`${event.ip} is not null or ${event.userAgent} is not null`))
      .orderBy(desc(event.receivedAt))
      .limit(1),
    trace.visitId
      ? db
          .select()
          .from(event)
          .where(and(where, eq(event.visitId, trace.visitId), eq(event.type, "fingerprint_ready")))
          .orderBy(desc(event.receivedAt))
          .limit(1)
      : [],
  ]);
  const environment: InterviewMediaEnvironment = { ...trace };
  for (const key of ["ip", "ipSource", "userAgent"] as const) {
    const value = request[0]?.[key];
    if (value) {
      environment[key] = value;
    }
  }
  for (const key of ["browserId", "fingerprint", "fingerprintVersion"] as const) {
    const column = key === "fingerprint" ? "fingerprintId" : key;
    const value =
      fingerprint[0]?.[column] ??
      request[0]?.[column] ??
      fingerprint[0]?.details[key] ??
      request[0]?.details[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }
  return { environment, role: evidence.role };
}

export async function reserveMediaSample(input: {
  roomSid: string;
  owner: string;
  participant: CaptureParticipant;
  kind: "image" | "audio";
  slot: string;
  trackSid?: string;
  skipReason?: string;
}) {
  const [room] = await db.select().from(archive).where(ownsLease(input.roomSid, input.owner));
  if (!room) {
    return null;
  }
  const { environment, role } = await environmentSnapshot(room.meetingId, input.participant);
  const id = randomUUID();
  const backend = input.skipReason ? null : mediaStorageBackend();
  const [row] = await db
    .insert(asset)
    .values({
      capturedAt: new Date(),
      environment,
      errorCode: input.skipReason,
      id,
      kind: input.kind,
      meetingId: room.meetingId,
      participantIdentity: input.participant.identity,
      participantName: input.participant.name,
      participantRole: role,
      participantSid: input.participant.sid,
      roomSid: room.roomSid,
      slot: input.slot,
      status: input.skipReason ? "skipped" : "pending",
      storageBackend: backend,
      storageKey: backend
        ? `human-interview-samples/${id}.${input.kind === "audio" ? "wav" : "jpg"}`
        : null,
      trackSid: input.trackSid,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function finishMediaSample(
  row: typeof asset.$inferSelect,
  owner: string,
  result: { bytes: Uint8Array; contentType: string; durationMs?: number },
) {
  if (!row.storageKey || !row.storageBackend) {
    throw new Error("Media reservation has no storage");
  }
  if (result.bytes.length > 2_000_000) {
    throw new Error("Media sample exceeds limit");
  }
  const [lease] = await db.select().from(archive).where(ownsLease(row.roomSid, owner));
  if (!lease) {
    throw new Error("Media lease lost");
  }
  // The key is already durable. An interrupted upload remains manually cleanable.
  await writeMedia(row.storageBackend, row.storageKey, result.bytes, result.contentType);
  await db
    .update(asset)
    .set({
      byteSize: result.bytes.length,
      contentType: result.contentType,
      durationMs: result.durationMs,
      sha256: createHash("sha256").update(result.bytes).digest("hex"),
      status: "ready",
    })
    .where(and(eq(asset.id, row.id), eq(asset.status, "pending")));
}
export async function failMediaSample(id: string, errorCode: string) {
  await db
    .update(asset)
    .set({ errorCode, status: "failed" })
    .where(and(eq(asset.id, id), eq(asset.status, "pending")));
}
export async function repairInterruptedSamples() {
  await db
    .update(asset)
    .set({ errorCode: "capture_interrupted", status: "failed" })
    .where(
      and(eq(asset.status, "pending"), lt(asset.capturedAt, sql`now() - interval '2 minutes'`)),
    );
}
