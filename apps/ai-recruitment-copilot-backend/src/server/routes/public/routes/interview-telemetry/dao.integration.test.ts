import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type * as TelemetryDao from "./dao";
import type * as LogsDao from "../../../platform/routes/interview-logs/dao";
import type { InterviewClientEvent } from "@arc/shared/interview-telemetry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt-in isolated database only; never use the developer/production DATABASE_URL for fixtures.
const url = process.env.INTERVIEW_TELEMETRY_TEST_DATABASE_URL;
describe.skipIf(!url)("telemetry database round trip", () => {
  let sql: ReturnType<typeof postgres>;
  let dao: typeof TelemetryDao;
  let logs: typeof LogsDao;
  beforeAll(async () => {
    if (!url) {
      throw new Error("Isolated test database required");
    }
    process.env.DATABASE_URL = url;
    sql = postgres(url, { max: 1 });
    await sql.unsafe(
      await readFile(
        new URL(
          "../../../../../../../ai-recruitment-copilot/drizzle/20261008120000_add_interview_telemetry/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    await sql`insert into interview_telemetry_event
      (id,event_key,meeting_id,organization_id,meeting_title,participant_identity,visit_id,source,type,occurred_at,details)
      values
      ('old-open','old-open','old','org','迁移测试','candidate_one','visit','client','page_opened',now(),'{"browserId":"10000000-0000-4000-8000-000000000001"}'),
      ('old-fp','old-fp','old','org','迁移测试','candidate_one','visit','client','fingerprint_ready',now(),${sql.json({ fingerprint: "a".repeat(32), fingerprintVersion: "old-version" })}),
      ('other-person','other-person','old','org','迁移测试','candidate_two','visit','client','page_opened',now(),'{}'),
      ('other-meeting','other-meeting','other','org','迁移测试','candidate_one','visit','client','page_opened',now(),'{}')`;
    await sql.unsafe(
      await readFile(
        new URL(
          "../../../../../../../ai-recruitment-copilot/drizzle/20261009231000_interview_browser_evidence_columns/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    expect(
      await sql`select id,browser_id,fingerprint_id,fingerprint_version from interview_telemetry_event where id='old-open'`,
    ).toMatchObject([
      {
        browser_id: "10000000-0000-4000-8000-000000000001",
        fingerprint_id: "a".repeat(32),
        fingerprint_version: "old-version",
      },
    ]);
    expect(
      await sql`select fingerprint_id from interview_telemetry_event where id in ('other-person','other-meeting')`,
    ).toEqual([{ fingerprint_id: null }, { fingerprint_id: null }]);
    await sql`alter table interview_telemetry_event add column ip_lookup_hash text`;
    await sql`delete from interview_telemetry_event`;
    await sql`create table studio_human_interview_meeting (id text primary key, organization_id text, title text, livekit_room_name text)`;
    await sql`insert into studio_human_interview_meeting values ('meeting', 'org', 'Miles 一面', 'human_room')`;
    dao = await import("./dao");
    logs = await import("../../../platform/routes/interview-logs/dao");
  });
  afterAll(async () => {
    if (!sql) {
      return;
    }
    await sql`drop table if exists interview_telemetry_event, studio_human_interview_meeting`;
    await sql.end();
    const { closeDatabase } = await import("@arc/ai-recruitment-copilot-backend/lib/server/db");
    await closeDatabase();
  });
  it("deduplicates retries, joins client/server/RTC events, and preserves history after meeting deletion", async () => {
    const trace = {
      attemptId: "00000000-0000-4000-8000-000000000003",
      tabId: "00000000-0000-4000-8000-000000000002",
      visitId: "00000000-0000-4000-8000-000000000001",
    };
    const scope = {
      meetingId: "meeting",
      meetingTitle: "Miles 一面",
      organizationId: "org",
      participantIdentity: "candidate_round",
      participantName: "申请者",
      participantRole: "candidate",
      roomName: "human_room",
    };
    const event = {
      clientSequence: 1,
      ...trace,
      details: {},
      id: "00000000-0000-4000-8000-000000000004",
      occurredAt: "2026-10-08T01:00:00.000Z",
      participantSid: "PA_1",
      type: "connected" as const,
    };
    await dao.saveClientEvents(scope, [event, event], new Headers());
    await dao.recordServerTelemetry({
      participantIdentity: scope.participantIdentity,
      roomName: "human_room",
      trace,
      type: "token_issued",
    });
    for (let i = 0; i < 2; i += 1) {
      await dao.recordServerTelemetry({
        details: { reason: "DUPLICATE_IDENTITY" },
        eventKey: "EV_1",
        participantIdentity: scope.participantIdentity,
        participantSid: "PA_1",
        roomName: "human_room",
        source: "livekit",
        trace,
        type: "participant_left",
      });
    }
    const filters = { page: 1, pageSize: 50 };
    const list = await logs.listLoggedMeetings(filters);
    expect(list.total).toBe(1);
    expect(list.records[0].eventCount).toBe(3);
    expect(list.records[0].fingerprintCount).toBe(0);
    expect(list.records[0].participants[0].fingerprints).toEqual([]);
    const detail = await logs.loadMeetingLog("meeting", filters);
    expect(detail.total).toBe(3);
    expect(detail.summary.attempts).toBe(1);
    expect(detail.summary.lastWebhookAt).not.toBeNull();
    const rtc = await logs.loadMeetingLog("meeting", { ...filters, source: "livekit" });
    expect(rtc.records[0].details.reason).toBe("DUPLICATE_IDENTITY");
    const missing = await logs.loadMeetingLog("different", filters);
    expect(missing.total).toBe(0);
    await dao.saveClientEvents(
      { ...scope, meetingTitle: "Miles 改名" },
      [
        {
          ...event,
          clientSequence: 2,
          details: { fingerprint: "a".repeat(32) },
          id: "00000000-0000-4000-8000-000000000005",
          type: "fingerprint_ready",
        },
      ],
      new Headers(),
    );
    const renamed = await logs.listLoggedMeetings(filters);
    expect(renamed.records).toHaveLength(1);
    expect(renamed.records[0].eventCount).toBe(4);
    expect(
      await sql`select count(*)::int AS count from interview_telemetry_event where fingerprint_id=${"a".repeat(32)} and meeting_id='meeting'`,
    ).toEqual([{ count: 4 }]);
    const nameSearch = await logs.listLoggedMeetings({ ...filters, search: "申请者" });
    expect(nameSearch.records[0].eventCount).toBe(4);
    const correlated = await logs.loadMeetingLog("meeting", {
      ...filters,
      fingerprint: "a".repeat(32),
    });
    expect(correlated.total).toBe(4);
    expect(correlated.participants).toHaveLength(1);
    const pageTwo = await logs.loadMeetingLog("meeting", { page: 2, pageSize: 2 });
    expect(pageTwo.records).toHaveLength(2);
    await sql`delete from studio_human_interview_meeting where id='meeting'`;
    await dao.recordServerTelemetry({
      eventKey: "EV_LATE",
      roomName: "human_room",
      source: "livekit",
      type: "room_finished",
    });
    const retained = await logs.loadMeetingLog("meeting", filters);
    expect(retained.total).toBe(5);
    await sql`update interview_telemetry_event set received_at = now() - interval '100 days' where event_key = 'EV_LATE'`;
    const { pruneInterviewTelemetry } = await import("./retention");
    await pruneInterviewTelemetry();
    const pruned = await logs.loadMeetingLog("meeting", filters);
    expect(pruned.total).toBe(4);
  });
  it("persists first-class browser evidence for client events and token requests", async () => {
    const trace = {
      browserId: randomUUID(),
      fingerprintId: "f".repeat(32),
      fingerprintVersion: "fingerprintjs-test",
      tabId: randomUUID(),
      visitId: randomUUID(),
    };
    await sql`insert into studio_human_interview_meeting values ('new-evidence', 'org', '独立字段', 'new-evidence-room')`;
    await dao.saveClientEvents(
      {
        meetingId: "new-evidence",
        meetingTitle: "独立字段",
        organizationId: "org",
        participantIdentity: "candidate_new",
        participantName: "候选人",
        participantRole: "candidate",
        roomName: "new-evidence-room",
      },
      [
        {
          ...trace,
          clientSequence: 1,
          details: {},
          id: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: "fingerprint_ready",
        },
      ],
      new Headers(),
    );
    await dao.recordServerTelemetry({
      headers: new Headers({
        "x-interview-browser-id": trace.browserId,
        "x-interview-fingerprint-id": trace.fingerprintId,
        "x-interview-fingerprint-version": trace.fingerprintVersion,
        "x-interview-tab-id": trace.tabId,
        "x-interview-visit-id": trace.visitId,
      }),
      participantIdentity: "candidate_new",
      roomName: "new-evidence-room",
      type: "token_issued",
    });
    const result = await logs.loadMeetingLog("new-evidence", {
      fingerprint: trace.fingerprintId,
      page: 1,
      pageSize: 50,
    });
    expect(result.total).toBe(2);
    for (const row of result.records) {
      expect(row).toMatchObject(trace);
      expect(row.details).not.toHaveProperty("fingerprint");
    }
  });
  it("filters routine events before pagination and summarizes participant evidence across all pages", async () => {
    await sql`insert into studio_human_interview_meeting values ('noise', 'org', '日志展示测试', 'human_noise')`;
    const scope = {
      meetingId: "noise",
      meetingTitle: "日志展示测试",
      organizationId: "org",
      participantIdentity: "candidate_noise",
      participantName: "候选人",
      participantRole: "candidate",
      roomName: "human_noise",
    };
    const trace = {
      attemptId: "10000000-0000-4000-8000-000000000003",
      tabId: "10000000-0000-4000-8000-000000000002",
      visitId: "10000000-0000-4000-8000-000000000001",
    };
    const signals: Pick<InterviewClientEvent, "type" | "details">[] = [
      { details: { browserId: "10000000-0000-4000-8000-000000000004" }, type: "page_opened" },
      { details: { fingerprint: "a".repeat(32) }, type: "fingerprint_ready" },
      { details: {}, type: "heartbeat" },
      { details: {}, type: "network_sample" },
      { details: {}, type: "component_unmounted" },
      { details: { state: "connected" }, type: "connection_state_changed" },
      { details: { quality: "good" }, type: "connection_quality_changed" },
      { details: { state: "signalReconnecting" }, type: "connection_state_changed" },
      { details: { quality: "poor" }, type: "connection_quality_changed" },
      { details: {}, type: "client_error" },
      { details: { reason: "DUPLICATE_IDENTITY" }, type: "disconnected" },
      { details: { online: false }, type: "network_changed" },
      { details: { state: "future_state" }, type: "connection_state_changed" },
    ];
    await dao.saveClientEvents(
      scope,
      signals.map((signal, index) => ({
        ...signal,
        ...trace,
        clientSequence: index + 1,
        id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        occurredAt: new Date(Date.UTC(2026, 9, 8, 1, 0, index)).toISOString(),
      })),
      new Headers({ "user-agent": "Candidate browser" }),
    );
    await dao.saveClientEvents(
      {
        ...scope,
        participantIdentity: "interviewer_noise",
        participantName: "面试官",
        participantRole: "host",
      },
      [
        {
          ...trace,
          clientSequence: 1,
          details: { fingerprint: "b".repeat(32) },
          id: "30000000-0000-4000-8000-000000000002",
          occurredAt: "2026-10-08T02:00:00Z",
          type: "fingerprint_ready",
          visitId: "30000000-0000-4000-8000-000000000001",
        },
      ],
      new Headers({ "user-agent": "Interviewer browser" }),
    );
    const key = await logs.loadMeetingLog("noise", { page: 1, pageSize: 2, view: "key" });
    expect(key.total).toBe(7);
    expect(key.records).toHaveLength(2);
    expect(key.summary).toMatchObject({ events: 14, fingerprints: 2, keyEvents: 7 });
    expect(key.records.map((e) => e.type)).not.toContain("heartbeat");
    expect(key.participants.find((p) => p.identity === scope.participantIdentity)).toMatchObject({
      browserIds: ["10000000-0000-4000-8000-000000000004"],
      fingerprints: ["a".repeat(32)],
      userAgents: ["Candidate browser"],
      visits: 1,
    });
    expect(key.participants.find((p) => p.identity === "interviewer_noise")?.fingerprints).toEqual([
      "b".repeat(32),
    ]);
    const all = await logs.loadMeetingLog("noise", { page: 1, pageSize: 50, view: "all" });
    expect(all.total).toBe(14);
    const explicitType = await logs.loadMeetingLog("noise", {
      page: 1,
      pageSize: 50,
      type: "heartbeat",
      view: "key",
    });
    expect(explicitType.total).toBe(1);
    const fingerprint = await logs.loadMeetingLog("noise", {
      fingerprint: "a".repeat(32),
      page: 1,
      pageSize: 50,
      view: "key",
    });
    expect(fingerprint.total).toBe(7);
    expect(
      fingerprint.records.every((e) => e.participantIdentity === scope.participantIdentity),
    ).toBe(true);
  });
  it("summarizes distinct fingerprints per identity across the whole meeting without mixing meetings or event types", async () => {
    async function saveFingerprints(
      meetingId: string,
      identity: string,
      role: string,
      fingerprints: string[],
    ) {
      await dao.saveClientEvents(
        {
          meetingId,
          meetingTitle: meetingId,
          organizationId: "org",
          participantIdentity: identity,
          participantName: identity,
          participantRole: role,
          roomName: `human_${meetingId}`,
        },
        fingerprints.map((fingerprint, index) => ({
          clientSequence: index + 1,
          details: { fingerprint },
          id: randomUUID(),
          occurredAt: "2026-10-08T01:00:00Z",
          tabId: randomUUID(),
          type: "fingerprint_ready",
          visitId: randomUUID(),
        })),
        new Headers(),
      );
    }
    const [a, b, c, d] = ["a", "b", "c", "d"].map((value) => value.repeat(32));
    await saveFingerprints("fingerprint_summary", "candidate_summary", "candidate", [a, a]);
    await saveFingerprints("fingerprint_summary", "interviewer_summary", "host", [a]);
    await saveFingerprints("fingerprint_other", "candidate_summary", "candidate", [d]);
    const filters = { page: 1, pageSize: 1, search: "fingerprint_summary" };
    const shared = await logs.listLoggedMeetings(filters);
    expect(shared.total).toBe(1);
    expect(shared.records[0]).toMatchObject({ fingerprintCount: 1, participantCount: 2 });
    expect(shared.records[0].participants.map((p) => p.fingerprints)).toEqual([[a], [a]]);
    await saveFingerprints("fingerprint_summary", "candidate_summary", "candidate", [b, "", " "]);
    await saveFingerprints("fingerprint_summary", "interviewer_summary", "host", [c]);
    await saveFingerprints("fingerprint_summary", "unknown_summary", "candidate", [""]);
    await sql`update interview_telemetry_event set participant_name = null where participant_identity = 'unknown_summary'`;
    await dao.recordServerTelemetry({
      details: { fingerprint: d },
      participantIdentity: "candidate_summary",
      roomName: "human_fingerprint_summary",
      type: "fingerprint_ready",
    });
    await saveFingerprints("fingerprint_summary", "candidate_summary", "candidate", [d]);
    await sql`update interview_telemetry_event set type = 'heartbeat' where meeting_id = 'fingerprint_summary' and source = 'client' and details->>'fingerprint' = ${d}`;
    const summary = await logs.listLoggedMeetings({ ...filters, type: "heartbeat" });
    expect(summary.records[0]).toMatchObject({ fingerprintCount: 3, participantCount: 3 });
    expect(summary.records[0].participants).toEqual([
      {
        fingerprints: [a, b],
        identity: "candidate_summary",
        name: "candidate_summary",
        role: "candidate",
      },
      {
        fingerprints: [a, c],
        identity: "interviewer_summary",
        name: "interviewer_summary",
        role: "host",
      },
      { fingerprints: [], identity: "unknown_summary", name: null, role: "candidate" },
    ]);
    const other = await logs.listLoggedMeetings({ ...filters, search: "fingerprint_other" });
    expect(other.records[0].fingerprintCount).toBe(1);
    expect(other.records[0].participants[0].fingerprints).toEqual([d]);
    const emptyPage = await logs.listLoggedMeetings({ ...filters, page: 2 });
    expect(emptyPage.total).toBe(1);
    expect(emptyPage.records).toEqual([]);
  });
});
