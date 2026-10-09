import { and, or, eq, inArray, ilike, gte, lte, desc, asc, count, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { interviewTelemetryEvent as event } from "@arc/db-schema/schema";
import type { LogQuery } from "./schema";

// Keep raw evidence intact. Only hide routine client signals in the key-event view;
// unfamiliar states and every server/LiveKit event remain visible.
const keyEventCondition = sql`not (
  ${event.source} = 'client' and (
    ${event.type} in ('heartbeat', 'network_sample', 'fingerprint_ready', 'component_unmounted')
    or (${event.type} = 'connection_state_changed'
        and coalesce(${event.details}->>'state', '') in ('connecting', 'connected', 'disconnected'))
    or (${event.type} = 'connection_quality_changed'
        and coalesce(${event.details}->>'quality', '') in ('excellent', 'good', 'unknown'))
  )
)`;

function conditions(q: LogQuery) {
  return and(
    q.view === "key" && !q.type ? keyEventCondition : undefined,
    q.search
      ? or(
          ilike(event.meetingTitle, `%${q.search}%`),
          ilike(event.participantName, `%${q.search}%`),
          ilike(event.participantIdentity, `%${q.search}%`),
          ilike(event.meetingId, `%${q.search}%`),
          ilike(event.roomName, `%${q.search}%`),
        )
      : undefined,
    q.since ? gte(event.receivedAt, new Date(q.since)) : undefined,
    q.until ? lte(event.receivedAt, new Date(q.until)) : undefined,
    q.source ? eq(event.source, q.source) : undefined,
    q.identity ? eq(event.participantIdentity, q.identity) : undefined,
    q.visitId ? eq(event.visitId, q.visitId) : undefined,
    q.attemptId ? eq(event.attemptId, q.attemptId) : undefined,
    q.type ? eq(event.type, q.type) : undefined,
    q.ip ? eq(event.ip, q.ip) : undefined,
    q.fingerprint
      ? sql`exists (
      select 1 from interview_telemetry_event fingerprint_event
      where fingerprint_event.meeting_id = ${event.meetingId}
        and fingerprint_event.participant_identity = ${event.participantIdentity}
        and fingerprint_event.visit_id = ${event.visitId}
        and fingerprint_event.type = 'fingerprint_ready'
        and fingerprint_event.fingerprint_id = ${q.fingerprint}
    )`
      : undefined,
  );
}

export async function listLoggedMeetings(q: LogQuery) {
  // Search chooses meetings; summary counts still cover every participant in each matched meeting.
  const where = inArray(
    event.meetingId,
    db.select({ meetingId: event.meetingId }).from(event).where(conditions(q)),
  );
  const [records, [total]] = await Promise.all([
    db
      .select({
        eventCount: count(),
        firstReceivedAt: sql<string>`min(${event.receivedAt})::text`,
        lastReceivedAt: sql<string>`max(${event.receivedAt})::text`,
        meetingId: event.meetingId,
        meetingTitle: sql<string>`(array_agg(${event.meetingTitle} order by ${event.receivedAt} desc, ${event.id} desc))[1]`,
        organizationId: sql<string>`max(${event.organizationId})`,
        participantCount: sql<number>`count(distinct nullif(${event.participantIdentity}, ''))::int`,
        roomName: sql<string | null>`max(${event.roomName})`,
      })
      .from(event)
      .where(where)
      .groupBy(event.meetingId)
      .orderBy(desc(sql`max(${event.receivedAt})`), asc(event.meetingId))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(distinct ${event.meetingId})::int` })
      .from(event)
      .where(where),
  ]);
  // One query for the current page, independent of the event filters that selected meetings.
  const participants = records.length
    ? await db
        .select({
          fingerprints: sql<string[]>`array_remove(array_agg(distinct case
            when ${event.source} = 'client' and ${event.type} = 'fingerprint_ready'
            then nullif(btrim(${event.fingerprintId}), '')
          end), null)`,
          identity: event.participantIdentity,
          meetingId: event.meetingId,
          name: sql<string | null>`max(${event.participantName})`,
          role: sql<string | null>`max(${event.participantRole})`,
        })
        .from(event)
        .where(
          and(
            inArray(
              event.meetingId,
              records.map((row) => row.meetingId),
            ),
            sql`${event.participantIdentity} <> ''`,
          ),
        )
        .groupBy(event.meetingId, event.participantIdentity)
        .orderBy(asc(sql`min(${event.receivedAt})`), asc(event.participantIdentity))
    : [];
  return {
    page: q.page,
    pageSize: q.pageSize,
    records: records.map((row) => {
      const meetingParticipants = participants
        .filter((participant) => participant.meetingId === row.meetingId)
        .map(({ fingerprints, identity, name, role }) => ({
          fingerprints: fingerprints.toSorted(),
          identity,
          name,
          role,
        }));
      return {
        ...row,
        fingerprintCount: new Set(meetingParticipants.flatMap((p) => p.fingerprints)).size,
        firstReceivedAt: new Date(row.firstReceivedAt).toISOString(),
        lastReceivedAt: new Date(row.lastReceivedAt).toISOString(),
        participants: meetingParticipants,
      };
    }),
    total: total.total,
  };
}

export async function loadMeetingLog(meetingId: string, q: LogQuery) {
  const where = and(eq(event.meetingId, meetingId), conditions(q));
  const [records, [total], participants, [summary]] = await Promise.all([
    db
      .select()
      .from(event)
      .where(where)
      .orderBy(
        asc(event.receivedAt),
        asc(event.occurredAt),
        asc(event.clientSequence),
        asc(event.id),
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(event).where(where),
    db
      .select({
        attempts: sql<number>`count(distinct ${event.attemptId})::int`,
        browserIds: sql<string[]>`array_remove(array_agg(distinct ${event.browserId}), null)`,
        fingerprints: sql<
          string[]
        >`array_remove(array_agg(distinct nullif(btrim(${event.fingerprintId}), '')), null)`,
        identity: event.participantIdentity,
        ips: sql<string[]>`array_remove(array_agg(distinct ${event.ip}), null)`,
        name: sql<string | null>`max(${event.participantName})`,
        role: sql<string | null>`max(${event.participantRole})`,
        userAgents: sql<string[]>`array_remove(array_agg(distinct ${event.userAgent}), null)`,
        visits: sql<number>`count(distinct ${event.visitId})::int`,
      })
      .from(event)
      .where(and(eq(event.meetingId, meetingId), sql`${event.participantIdentity} <> ''`))
      .groupBy(event.participantIdentity)
      .orderBy(asc(sql`min(${event.receivedAt})`), asc(event.participantIdentity)),
    db
      .select({
        attempts: sql<number>`count(distinct ${event.attemptId})::int`,
        events: count(),
        fingerprints: sql<number>`count(distinct nullif(btrim(${event.fingerprintId}), ''))::int`,
        keyEvents: sql<number>`count(*) filter (where ${keyEventCondition})::int`,
        lastWebhookAt: sql<
          string | null
        >`max(${event.receivedAt}) filter (where ${event.source} = 'livekit')::text`,
        meetingTitle: sql<
          string | null
        >`(array_agg(${event.meetingTitle} order by ${event.receivedAt} desc, ${event.id} desc))[1]`,
        roomName: sql<string>`max(${event.roomName})`,
        visits: sql<number>`count(distinct ${event.visitId})::int`,
      })
      .from(event)
      .where(eq(event.meetingId, meetingId)),
  ]);
  return {
    page: q.page,
    pageSize: q.pageSize,
    participants: participants.filter((r) => r.name),
    records: records.map((r) => ({
      ...r,
      occurredAt: r.occurredAt.toISOString(),
      receivedAt: r.receivedAt.toISOString(),
    })),
    summary: {
      ...summary,
      lastWebhookAt: summary.lastWebhookAt ? new Date(summary.lastWebhookAt).toISOString() : null,
    },
    total: total.total,
  };
}
