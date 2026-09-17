import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { listStudioCalendarEvents } from "./dao";
import { findHumanInterviewConflicts } from "../interviews/dao/human-interview-conflicts";

// Explicit opt-in: never use the application's shared DATABASE_URL for fixtures.
const fixture = vi.hoisted(() => ({ url: process.env.CALENDAR_TEST_DATABASE_URL }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { databaseCodecs } =
    await import("@arc/ai-recruitment-copilot-backend/lib/server/db/timestamp-codecs");
  const { default: connect } = await import("postgres");
  const client = connect(fixture.url ?? "postgres://localhost/calendar_test", {
    connection: { TimeZone: "Asia/Shanghai" },
    max: 1,
  });
  return { calendarTestClient: client, db: drizzle({ client, codecs: databaseCodecs }) };
});

const list = (start = "2026-09-18T00:00:00+08:00", end = "2026-09-19T00:00:00+08:00") =>
  listStudioCalendarEvents({
    end: new Date(end),
    organizationId: "org",
    start: new Date(start),
    visibilityScope: { kind: "all" },
  });

describe.skipIf(!fixture.url)("calendar DAO interval overlap (PostgreSQL)", () => {
  let client: ReturnType<typeof postgres>;
  beforeAll(async () => {
    const dbModule = await import("@arc/ai-recruitment-copilot-backend/lib/server/db");
    client = (dbModule as unknown as { calendarTestClient: typeof client }).calendarTestClient;
    // TEMP tables shadow public tables and disappear when this connection closes.
    await client.unsafe(`
      CREATE TEMP TABLE studio_interview (id text, organization_id text, created_by text, candidate_name text);
      CREATE TEMP TABLE studio_human_interview_round (id text, organization_id text, interview_record_id text,
        format text, location text, meeting_url text, label text, status text, scheduled_at timestamp, sort_order int);
      CREATE TEMP TABLE studio_human_interview_meeting (id text, status text, title text,
        scheduled_at timestamp, started_at timestamp, ended_at timestamp, valid_until timestamptz);
      ALTER TABLE studio_human_interview_meeting ADD organization_id text DEFAULT 'org';
      CREATE TEMP TABLE studio_human_interview_meeting_round (meeting_id text, round_id text);
      CREATE TEMP TABLE studio_human_interview_round_interviewer (round_id text, user_id text);
      CREATE TEMP TABLE studio_human_interview_meeting_interviewer (meeting_id text, user_id text);
      CREATE TEMP TABLE member (organization_id text, user_id text, is_interviewer boolean);
      CREATE TEMP TABLE "user" (id text, name text);
      CREATE TEMP TABLE studio_interview_schedule (id text, organization_id text, interview_record_id text,
        round_label text, scheduled_at timestamp, scheduled_end_at timestamp, status text, sort_order int);
      CREATE TEMP TABLE interview_conversation (conversation_id text, organization_id text,
        schedule_entry_id text, started_at timestamp, ended_at timestamp);
    `);
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.unsafe(`
      TRUNCATE studio_interview, studio_human_interview_round, studio_human_interview_meeting,
        studio_human_interview_meeting_round, studio_interview_schedule, interview_conversation,
        studio_human_interview_meeting_interviewer, studio_human_interview_round_interviewer, member, "user";
      INSERT INTO studio_interview VALUES ('candidate', 'org', 'creator', '测试候选人');
      INSERT INTO studio_human_interview_round VALUES
        ('round', 'org', 'candidate', 'online', null, null, '三面', 'pending', '2026-09-16 17:02', 0);
      INSERT INTO studio_human_interview_meeting VALUES
        ('meeting', 'scheduled', '三面', '2026-09-16 17:02', null, null, '2026-09-19 02:02+08', 'org');
      INSERT INTO studio_human_interview_meeting_round VALUES ('meeting', 'round');
      INSERT INTO "user" VALUES ('interviewer-1', '面试官一'), ('interviewer-2', '面试官二');
      INSERT INTO member VALUES ('org', 'interviewer-1', true), ('org', 'interviewer-2', true);
      INSERT INTO studio_human_interview_round_interviewer VALUES ('round', 'interviewer-1');
      INSERT INTO studio_human_interview_meeting_interviewer VALUES ('meeting', 'interviewer-1'), ('meeting', 'interviewer-2');
    `);
  });

  it("returns a human meeting on the middle day with its full configured duration", async () => {
    expect(await list()).toEqual([
      expect.objectContaining({
        endAt: "2026-09-18T18:02:00.000Z",
        id: "meeting",
        startAt: "2026-09-16T17:02:00.000Z",
      }),
    ]);
  });

  it("keeps the full duration in a range containing its start", async () => {
    expect(await list("2026-09-16T00:00:00Z", "2026-09-20T00:00:00Z")).toEqual([
      expect.objectContaining({ endAt: "2026-09-18T18:02:00.000Z" }),
    ]);
  });

  it("uses exclusive range boundaries", async () => {
    expect(await list("2026-09-19T02:02:00+08:00", "2026-09-20T00:00:00+08:00")).toEqual([]);
    expect(await list("2026-09-16T00:00:00Z", "2026-09-16T17:02:00Z")).toEqual([]);
    expect(await list("2026-09-19T02:01:00+08:00", "2026-09-19T02:02:00+08:00")).toHaveLength(1);
  });

  it("queries and renders actual meeting times when rescheduled across days", async () => {
    await client`UPDATE studio_human_interview_meeting SET started_at = '2026-09-20 01:00', ended_at = '2026-09-20 02:00'`;
    expect(await list("2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z")).toEqual([
      expect.objectContaining({
        endAt: "2026-09-20T02:00:00.000Z",
        startAt: "2026-09-20T01:00:00.000Z",
      }),
    ]);
    expect(await list()).toEqual([]);
  });

  it.each([null, "2026-09-15T00:00:00Z"])(
    "falls back to one hour for invalid end %s",
    async (validUntil) => {
      await client`UPDATE studio_human_interview_meeting SET valid_until = ${validUntil}`;
      expect(await list("2026-09-16T18:00:00Z", "2026-09-16T19:00:00Z")).toEqual([
        expect.objectContaining({ endAt: "2026-09-16T18:02:00.000Z" }),
      ]);
      expect(await list()).toEqual([]);
    },
  );

  it("includes AI plans that cross a month boundary", async () => {
    await client`INSERT INTO studio_interview_schedule VALUES
      ('ai', 'org', 'candidate', 'AI', '2026-09-30 15:00', '2026-09-30 17:00', 'pending', 0)`;
    expect(await list("2026-10-01T00:00:00+08:00", "2026-11-01T00:00:00+08:00")).toEqual([
      expect.objectContaining({
        endAt: "2026-09-30T17:00:00.000Z",
        id: "ai:ai",
        startAt: "2026-09-30T15:00:00.000Z",
      }),
    ]);
    expect(await list("2026-10-01T01:00:00+08:00", "2026-11-01T00:00:00+08:00")).toEqual([]);
  });

  it("preserves creator visibility, organization isolation and cancellation", async () => {
    const input = {
      end: new Date("2026-09-20"),
      organizationId: "org",
      start: new Date("2026-09-16"),
    };
    expect(
      await listStudioCalendarEvents({
        ...input,
        visibilityScope: { kind: "restricted", userIds: ["other"] },
      }),
    ).toEqual([]);
    expect(await listStudioCalendarEvents({ ...input, visibilityScope: { kind: "none" } })).toEqual(
      [],
    );
    expect(
      await listStudioCalendarEvents({
        ...input,
        organizationId: "other",
        visibilityScope: { kind: "all" },
      }),
    ).toEqual([]);
    expect(
      await listStudioCalendarEvents({
        ...input,
        visibilityScope: { kind: "restricted", userIds: ["creator"] },
      }),
    ).toHaveLength(1);
    await client`UPDATE studio_human_interview_meeting SET status = 'cancelled'`;
    expect(await list()).toEqual([]);
  });

  it("includes actual AI interviews across midnight without resurrecting the completed plan", async () => {
    await client`INSERT INTO studio_interview_schedule VALUES
      ('ai', 'org', 'candidate', 'AI', '2026-09-30 15:00', '2026-09-30 18:00', 'completed', 0)`;
    await client`INSERT INTO interview_conversation VALUES
      ('conversation', 'org', 'ai', '2026-09-30 15:30', '2026-09-30 17:00')`;
    expect(await list("2026-10-01T00:00:00+08:00", "2026-10-02T00:00:00+08:00")).toEqual([
      expect.objectContaining({
        endAt: "2026-09-30T17:00:00.000Z",
        id: "ai-result:conversation",
        startAt: "2026-09-30T15:30:00.000Z",
      }),
    ]);
    expect(await list("2026-10-01T01:00:00+08:00", "2026-10-02T00:00:00+08:00")).toEqual([]);
  });

  it("includes unlinked legacy rounds across midnight and week boundaries", async () => {
    await client`DELETE FROM studio_human_interview_meeting_round`;
    await client`UPDATE studio_human_interview_round SET scheduled_at = '2026-09-20 15:30'`;
    expect(await list("2026-09-21T00:00:00+08:00", "2026-09-28T00:00:00+08:00")).toEqual([
      expect.objectContaining({
        endAt: "2026-09-20T16:30:00.000Z",
        id: "round",
        startAt: "2026-09-20T15:30:00.000Z",
      }),
    ]);
  });

  it("also handles modern timestamptz columns without shifting eight hours", async () => {
    await client`BEGIN`;
    try {
      await client.unsafe(`
        ALTER TABLE studio_human_interview_round ALTER scheduled_at TYPE timestamptz USING scheduled_at AT TIME ZONE 'UTC';
        ALTER TABLE studio_human_interview_meeting
          ALTER scheduled_at TYPE timestamptz USING scheduled_at AT TIME ZONE 'UTC',
          ALTER started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC',
          ALTER ended_at TYPE timestamptz USING ended_at AT TIME ZONE 'UTC';
      `);
      expect(await list()).toEqual([
        expect.objectContaining({
          endAt: "2026-09-18T18:02:00.000Z",
          startAt: "2026-09-16T17:02:00.000Z",
        }),
      ]);
    } finally {
      await client`ROLLBACK`;
    }
  });

  it("finds all assigned interviewers' conflicts across days, exposing only availability", async () => {
    const conflicts = await findHumanInterviewConflicts({
      input: {
        interviewerIds: ["interviewer-1", "interviewer-2"],
        scheduledAt: "2026-09-18T01:00:00Z",
        validUntil: "2026-09-18T02:00:00Z",
      },
      organizationId: "org",
    });
    expect(conflicts).toEqual([
      {
        endAt: "2026-09-18T18:02:00.000Z",
        interviewerId: "interviewer-1",
        interviewerName: "面试官一",
        startAt: "2026-09-16T17:02:00.000Z",
      },
      {
        endAt: "2026-09-18T18:02:00.000Z",
        interviewerId: "interviewer-2",
        interviewerName: "面试官二",
        startAt: "2026-09-16T17:02:00.000Z",
      },
    ]);
  });

  it("does not report adjacent or cancelled meetings as conflicts", async () => {
    const input = { interviewerIds: ["interviewer-1"], scheduledAt: "2026-09-18T18:02:00Z" };
    expect(await findHumanInterviewConflicts({ input, organizationId: "org" })).toEqual([]);
    await client`UPDATE studio_human_interview_meeting SET status = 'cancelled'`;
    expect(
      await findHumanInterviewConflicts({
        input: { ...input, scheduledAt: "2026-09-18T01:00:00Z" },
        organizationId: "org",
      }),
    ).toEqual([]);
  });

  it("checks standalone rounds but excludes the round being given its own meeting", async () => {
    await client`DELETE FROM studio_human_interview_meeting_round`;
    const input = { interviewerIds: ["interviewer-1"], scheduledAt: "2026-09-16T18:00:00Z" };
    expect(await findHumanInterviewConflicts({ input, organizationId: "org" })).toHaveLength(1);
    expect(
      await findHumanInterviewConflicts({
        input: { ...input, excludeRoundIds: ["round"] },
        organizationId: "org",
      }),
    ).toEqual([]);
  });

  it("does not count AI plans as interviewer occupancy", async () => {
    await client`INSERT INTO studio_interview_schedule VALUES
      ('ai', 'org', 'candidate', 'AI', '2026-10-01 01:00', '2026-10-01 03:00', 'pending', 0)`;
    expect(
      await findHumanInterviewConflicts({
        input: { interviewerIds: ["interviewer-1"], scheduledAt: "2026-10-01T02:00:00Z" },
        organizationId: "org",
      }),
    ).toEqual([]);
  });

  it("keeps conflicts inside the active organization even for shared interviewers", async () => {
    await client`UPDATE studio_human_interview_meeting SET organization_id = 'other'`;
    expect(
      await findHumanInterviewConflicts({
        input: {
          interviewerIds: ["interviewer-1"],
          scheduledAt: "2026-09-18T01:00:00Z",
        },
        organizationId: "org",
      }),
    ).toEqual([]);
  });

  it("deduplicates the same occupied interval across meeting and standalone round records", async () => {
    await client`UPDATE studio_human_interview_meeting SET valid_until = '2026-09-16T18:02:00Z'`;
    await client`INSERT INTO studio_human_interview_round VALUES
      ('standalone', 'org', 'candidate', 'online', null, null, '重复时段', 'pending', '2026-09-16 17:02', 1)`;
    await client`INSERT INTO studio_human_interview_round_interviewer VALUES ('standalone', 'interviewer-1')`;
    expect(
      await findHumanInterviewConflicts({
        input: {
          interviewerIds: ["interviewer-1"],
          scheduledAt: "2026-09-16T18:00:00Z",
        },
        organizationId: "org",
      }),
    ).toHaveLength(1);
  });

  it("validates membership and the time range before checking availability", async () => {
    await expect(
      findHumanInterviewConflicts({
        input: { interviewerIds: ["interviewer-1"], scheduledAt: "2026-09-18T01:00:00Z" },
        organizationId: "other",
      }),
    ).rejects.toThrow("面试官");
    await expect(
      findHumanInterviewConflicts({
        input: {
          interviewerIds: ["interviewer-1"],
          scheduledAt: "2026-09-18T01:00:00Z",
          validUntil: "2026-09-18T00:00:00Z",
        },
        organizationId: "org",
      }),
    ).rejects.toThrow("晚于");
  });
});
