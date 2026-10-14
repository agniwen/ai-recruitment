import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { ResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { listStudioCalendarEvents, loadAiCalendarEventPreview } from "./dao";
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
      CREATE TEMP TABLE studio_human_interview_external_interviewer (id text, round_id text, name text);
      CREATE TEMP TABLE studio_human_interview_round_interviewer (round_id text, user_id text);
      CREATE TEMP TABLE studio_human_interview_meeting_interviewer (meeting_id text, user_id text);
      CREATE TEMP TABLE member (organization_id text, user_id text, is_interviewer boolean);
      CREATE TEMP TABLE "user" (id text, name text);
      CREATE TEMP TABLE studio_interview_schedule (id text, organization_id text, interview_record_id text,
        round_label text, scheduled_at timestamp, scheduled_end_at timestamp, status text, sort_order int);
      CREATE TEMP TABLE interview_conversation (conversation_id text, organization_id text,
        schedule_entry_id text, started_at timestamp, ended_at timestamp);
      ALTER TABLE studio_interview
        ADD job_description_id text DEFAULT 'jd', ADD pipeline_stage text DEFAULT 'human_interview',
        ADD ai_review_approval_status text DEFAULT 'approved', ADD ai_review_assigned_odc_user_id text,
        ADD target_role text;
      ALTER TABLE member ADD id text, ADD role text, ADD odc_scope_mode text DEFAULT 'selected';
      ALTER TABLE studio_interview_schedule
        ADD allow_text_input boolean DEFAULT false, ADD conversation_id text,
        ADD disconnected_at timestamp, ADD session_started_at timestamp;
      CREATE TEMP TABLE organization_role (organization_id text, role text, is_odc boolean);
      CREATE TEMP TABLE resume_source_odc_member (organization_id text, member_id text,
        resume_source_id text, job_series text, service_unit text);
      CREATE TEMP TABLE job_description (id text, organization_id text, name text,
        resume_source_id text, job_series text, service_unit text);
      CREATE TEMP TABLE studio_interview_odc_assignment (interview_record_id text, user_id text);
    `);
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.unsafe(`
      TRUNCATE studio_human_interview_external_interviewer, studio_interview, studio_human_interview_round, studio_human_interview_meeting,
        studio_human_interview_meeting_round, studio_interview_schedule, interview_conversation,
        studio_human_interview_meeting_interviewer, studio_human_interview_round_interviewer, member, "user",
        organization_role, resume_source_odc_member, job_description, studio_interview_odc_assignment;
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

  describe("ODC candidate visibility", () => {
    const visibilityScope: ResumeVisibilityScope = {
      actor: { organizationId: "org", userId: "odc" },
      odc: { departmentIds: [], hiringUnitIds: [], resumeSourceIds: ["source"] },
      odcActor: { organizationId: "org", userId: "odc" },
      recruiting: { kind: "restricted", userIds: ["odc"] },
    };
    const input = {
      end: new Date("2026-09-20"),
      organizationId: "org",
      start: new Date("2026-09-16"),
      visibilityScope,
    };
    const preview = () =>
      loadAiCalendarEventPreview({
        organizationId: "org",
        roundId: "ai-plan",
        visibilityScope,
      });

    beforeEach(async () => {
      await client.unsafe(`
        INSERT INTO member VALUES ('org', 'odc', false, 'odc-member', 'odc', 'selected');
        INSERT INTO organization_role VALUES ('org', 'odc', true);
        INSERT INTO resume_source_odc_member VALUES ('org', 'odc-member', 'source', NULL, NULL);
        INSERT INTO job_description VALUES ('jd', 'org', '前端开发', 'source', NULL, NULL);
        INSERT INTO studio_interview_odc_assignment VALUES ('candidate', 'odc');
        INSERT INTO studio_interview_schedule (id, organization_id, interview_record_id, round_label,
          scheduled_at, scheduled_end_at, status, sort_order) VALUES
          ('ai-plan', 'org', 'candidate', 'AI 计划', '2026-09-18 01:00', '2026-09-18 02:00', 'pending', 0),
          ('ai-result', 'org', 'candidate', 'AI 记录', '2026-09-18 03:00', '2026-09-18 04:00', 'completed', 1);
        INSERT INTO interview_conversation VALUES ('conversation', 'org', 'ai-result', '2026-09-18 03:00', '2026-09-18 04:00');
      `);
    });

    it("shows another creator's assigned candidate in human, AI plan and AI result events", async () => {
      const events = await listStudioCalendarEvents(input);
      expect(events.map((event) => event.id)).toEqual([
        "meeting",
        "ai:ai-plan",
        "ai-result:conversation",
      ]);
      expect(await preview()).toMatchObject({
        candidate: { id: "candidate" },
        round: { id: "ai-plan" },
      });
    });

    it.each([
      ["unassigned candidate", "DELETE FROM studio_interview_odc_assignment"],
      [
        "assignment to another ODC",
        "UPDATE studio_interview_odc_assignment SET user_id = 'another-odc'",
      ],
      ["pending approval", "UPDATE studio_interview SET ai_review_approval_status = 'pending'"],
      ["rejected approval", "UPDATE studio_interview SET ai_review_approval_status = 'rejected'"],
      ["revoked source", "DELETE FROM resume_source_odc_member"],
      ["revoked ODC role", "UPDATE organization_role SET is_odc = false"],
      ["different job series", "UPDATE resume_source_odc_member SET job_series = 'other'"],
      ["different service unit", "UPDATE resume_source_odc_member SET service_unit = 'other'"],
    ])("hides events and preview for %s", async (_label, mutation) => {
      await client.unsafe(mutation);
      expect(await listStudioCalendarEvents(input)).toEqual([]);
      expect(await preview()).toBeNull();
    });

    it("preserves workspace isolation for an assigned candidate", async () => {
      expect(await listStudioCalendarEvents({ ...input, organizationId: "other" })).toEqual([]);
      expect(
        await loadAiCalendarEventPreview({
          organizationId: "other",
          roundId: "ai-plan",
          visibilityScope,
        }),
      ).toBeNull();
    });

    it("does not expose unassigned candidates sharing the same meeting", async () => {
      await client.unsafe(`
        INSERT INTO studio_interview VALUES ('hidden-candidate', 'org', 'creator', '未分配候选人');
        INSERT INTO studio_human_interview_round VALUES
          ('hidden-round', 'org', 'hidden-candidate', 'online', null, null, '三面', 'pending', '2026-09-16 17:02', 0);
        INSERT INTO studio_human_interview_meeting_round VALUES ('meeting', 'hidden-round');
      `);
      const events = await listStudioCalendarEvents(input);
      const meeting = events.find((event) => event.id === "meeting");
      expect(meeting?.candidates.map((candidate) => candidate.interviewRecordId)).toEqual([
        "candidate",
      ]);
    });
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

  it("includes internal and external interviewers without exposing contact details", async () => {
    await client`INSERT INTO studio_human_interview_external_interviewer VALUES ('external-1', 'round', '外部面试官')`;
    expect(await list()).toEqual([
      expect.objectContaining({
        interviewers: [
          { id: "interviewer-1", kind: "internal", name: "面试官一" },
          { id: "external-1", kind: "external", name: "外部面试官" },
        ],
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
