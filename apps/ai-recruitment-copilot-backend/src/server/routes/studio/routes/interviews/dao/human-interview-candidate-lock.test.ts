import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findHumanInterviewCandidateLock } from "./human-interview-candidate-lock";
import { completeHumanInterviewRound, createHumanInterviewRound } from "./human-interview-rounds";
import {
  loadPlatformInterviewConfig,
  savePlatformInterviewConfig,
} from "@arc/ai-recruitment-copilot-backend/server/routes/platform/routes/interview-config/dao";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { PGlite: Client } = await import("@electric-sql/pglite");
  const { drizzle: connect } = await import("drizzle-orm/pglite");
  return { db: connect({ client: new Client() }) };
});

const client = db.$client as unknown as PGlite;
const now = new Date("2026-10-19T10:00:00Z");
const check = () =>
  findHumanInterviewCandidateLock({
    interviewRecordId: "b",
    now,
    organizationId: "workspace",
  });

describe("candidate locks across hiring units", () => {
  beforeAll(async () => {
    await client.exec(`
      CREATE TABLE hiring_unit (id text PRIMARY KEY, name text NOT NULL);
      CREATE TABLE organization (id text PRIMARY KEY);
      INSERT INTO organization VALUES ('workspace');
      CREATE TABLE "user" (id text PRIMARY KEY, name text, image text);
      CREATE TABLE studio_interview (id text PRIMARY KEY, organization_id text, hiring_unit_id text,
        candidate_email text, candidate_phone text, resume_content_hash text, resume_source_pool_item_id text);
      CREATE TABLE studio_human_interview_round (id text PRIMARY KEY, interview_record_id text,
        organization_id text, status text, scheduled_at timestamptz,
        cancel_reason text, cancelled_at timestamptz, completed_at timestamptz,
        completed_by text, completed_by_role text, created_at timestamptz DEFAULT now(),
        created_by text, created_by_role text, feedback text, format text, label text,
        location text, meeting_url text, notes text, outcome text, score integer,
        sort_order integer DEFAULT 0, started_at timestamptz, updated_at timestamptz DEFAULT now());
      CREATE TABLE studio_human_interview_round_interviewer (round_id text, user_id text);
      CREATE TABLE studio_human_interview_external_interviewer (id text, round_id text, name text, telegram text, joined_at timestamptz, left_at timestamptz);
      CREATE TABLE studio_human_interview_meeting (id text PRIMARY KEY, status text, scheduled_at timestamptz, valid_until timestamptz);
      CREATE TABLE studio_human_interview_meeting_round (round_id text, meeting_id text);
      INSERT INTO studio_human_interview_round (id,interview_record_id,organization_id,status,scheduled_at)
        VALUES ('legacy','a','workspace','pending','2026-10-20T10:00:00Z');
    `);
    await client.exec(
      await readFile(
        new URL(
          "../../../../../../../../ai-recruitment-copilot/drizzle/20261019120000_human_interview_candidate_lock/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    const legacy = await client.query<{ lock_hours: number }>(
      "SELECT lock_hours FROM studio_human_interview_round",
    );
    expect(legacy.rows[0]?.lock_hours).toBe(48);
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    await client.exec(`
      TRUNCATE hiring_unit, studio_interview, studio_human_interview_round, studio_human_interview_meeting, studio_human_interview_meeting_round;
      UPDATE platform_interview_config SET human_interview_lock_hours=48;
      INSERT INTO hiring_unit VALUES ('unit-a','A用工单位'),('unit-b','B用工单位');
      INSERT INTO studio_interview (id,organization_id,hiring_unit_id,resume_source_pool_item_id)
        VALUES ('a','workspace','unit-a','pool'),('b','workspace','unit-b','pool');
      INSERT INTO studio_human_interview_round (id,interview_record_id,organization_id,status,scheduled_at,created_at,lock_hours)
        VALUES ('round','a','workspace','pending','2026-10-20T10:00:00Z','2026-10-19T10:00:00Z',48);
      INSERT INTO studio_human_interview_meeting VALUES ('meeting','scheduled','2026-10-20T10:00:00Z','2026-10-24T10:00:00Z');
      INSERT INTO studio_human_interview_meeting_round VALUES ('round','meeting');
    `);
  });
  afterEach(() => vi.useRealTimers());

  it("blocks for the snapshotted duration from creation, regardless of the scheduled start", async () => {
    const lock = await check();
    expect(lock).toMatchObject({
      hiringUnitName: "A用工单位",
      unlockAt: "2026-10-21T10:00:00.000Z",
    });
    expect(lock?.message).toContain("48小时");
    expect(lock?.message).toContain("完成面试点评");
  });
  it("releases exactly when the snapshotted duration elapses", async () => {
    await client.exec("UPDATE studio_human_interview_round SET created_at='2026-10-17T10:00:00Z'");
    expect(await check()).toBeNull();
  });
  it.each(["ended", "cancelled"])(
    "keeps the lock when the meeting is %s but evaluation is unfinished",
    async (status) => {
      await client.query("UPDATE studio_human_interview_meeting SET status=$1", [status]);
      expect(await check()).not.toBeNull();
    },
  );
  it.each(["completed", "cancelled"])("releases when the round is %s", async (status) => {
    await client.query("UPDATE studio_human_interview_round SET status=$1", [status]);
    expect(await check()).toBeNull();
  });
  it("keeps the full creation-based lock for a one-hour meeting and after validity expires", async () => {
    await client.exec(
      "UPDATE studio_human_interview_round SET scheduled_at='2026-10-19T10:00:00Z'; UPDATE studio_human_interview_meeting SET scheduled_at='2026-10-19T10:00:00Z', valid_until='2026-10-19T11:00:00Z'",
    );
    const lock = await check();
    expect(lock?.unlockAt).toBe("2026-10-21T10:00:00.000Z");
    await client.exec(
      "UPDATE studio_human_interview_meeting SET valid_until='2026-10-19T10:00:00Z'",
    );
    expect(await check()).not.toBeNull();
  });
  it("does not extend the lock when scheduling details change or disappear", async () => {
    await client.exec(
      "UPDATE studio_human_interview_round SET scheduled_at='2026-11-01T10:00:00Z'; UPDATE studio_human_interview_meeting SET scheduled_at='2026-11-01T10:00:00Z', valid_until='2026-11-02T10:00:00Z'",
    );
    const rescheduled = await check();
    expect(rescheduled?.unlockAt).toBe("2026-10-21T10:00:00.000Z");
    await client.exec(
      "UPDATE studio_human_interview_round SET scheduled_at=NULL; UPDATE studio_human_interview_meeting SET scheduled_at=NULL, valid_until=NULL",
    );
    expect(await check()).not.toBeNull();
  });
  it("releases after evaluation is completed, while meeting end alone does not release", async () => {
    await client.exec("UPDATE studio_human_interview_meeting SET status='ended'");
    expect(await check()).not.toBeNull();
    await completeHumanInterviewRound({
      feedback: "测试点评已完成",
      organizationId: "workspace",
      outcome: "pass",
      roundId: "round",
    });
    expect(await check()).toBeNull();
  });
  it("continues blocking while another unfinished round is still inside its creation window", async () => {
    await client.exec(
      "UPDATE studio_human_interview_round SET status='completed'; INSERT INTO studio_human_interview_round (id,interview_record_id,organization_id,status,created_at,lock_hours) VALUES ('another-round','a','workspace','pending','2026-10-18T10:00:00Z',48)",
    );
    const lock = await check();
    expect(lock?.unlockAt).toBe("2026-10-20T10:00:00.000Z");
  });
  it("allows the same hiring unit and ignores other workspaces", async () => {
    await client.exec("UPDATE studio_interview SET hiring_unit_id='unit-a' WHERE id='b'");
    expect(await check()).toBeNull();
    await client.exec(
      "UPDATE studio_interview SET hiring_unit_id='unit-b' WHERE id='b'; UPDATE studio_interview SET organization_id='other' WHERE id='a'",
    );
    expect(await check()).toBeNull();
  });
  it.each([
    ["candidate_email", " Person@Example.com ", "person@example.com"],
    ["candidate_phone", "+86 (138) 0000-0000", "8613800000000"],
    ["resume_content_hash", "hash", "hash"],
  ])("recognizes a candidate using %s across separate resume imports", async (column, a, b) => {
    await client.exec("UPDATE studio_interview SET resume_source_pool_item_id=NULL");
    await client.query(`UPDATE studio_interview SET ${column}=$1 WHERE id='a'`, [a]);
    await client.query(`UPDATE studio_interview SET ${column}=$1 WHERE id='b'`, [b]);
    expect(await check()).not.toBeNull();
  });
  it("does not match blank contact information", async () => {
    await client.exec(
      "UPDATE studio_interview SET resume_source_pool_item_id=NULL, candidate_email=' ', candidate_phone=' '",
    );
    expect(await check()).toBeNull();
  });
  it("keeps the round snapshot after the platform duration changes", async () => {
    await client.exec("UPDATE platform_interview_config SET human_interview_lock_hours=24");
    const lock = await check();
    expect(lock?.unlockAt).toBe("2026-10-21T10:00:00.000Z");
  });
  it("protects a saved round even before its meeting is created", async () => {
    await client.exec("DELETE FROM studio_human_interview_meeting_round");
    expect(await check()).not.toBeNull();
  });
  it("checks again on save even if the form was opened before another unit booked", async () => {
    await expect(
      createHumanInterviewRound({
        input: {
          externalInterviewers: [{ name: "面试官", telegram: "interviewer" }],
          format: "online",
          interviewerIds: [],
          label: "复面",
          scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        interviewRecordId: "b",
        organizationId: "workspace",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const saved = await client.query(
      "SELECT id FROM studio_human_interview_round WHERE interview_record_id='b'",
    );
    expect(saved.rows).toEqual([]);
  });
  it("snapshots the latest policy only for newly saved rounds", async () => {
    await client.exec(
      "UPDATE studio_human_interview_round SET status='cancelled'; UPDATE platform_interview_config SET human_interview_lock_hours=24",
    );
    const round = await createHumanInterviewRound({
      input: {
        externalInterviewers: [{ name: "面试官", telegram: "interviewer" }],
        format: "online",
        interviewerIds: [],
        label: "复面",
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      interviewRecordId: "b",
      organizationId: "workspace",
    });
    const snapshot = await client.query<{ lock_hours: number }>(
      "SELECT lock_hours FROM studio_human_interview_round WHERE id=$1",
      [round.id],
    );
    expect(snapshot.rows[0]?.lock_hours).toBe(24);
    const existing = await client.query<{ lock_hours: number }>(
      "SELECT lock_hours FROM studio_human_interview_round WHERE id='round'",
    );
    expect(existing.rows[0]?.lock_hours).toBe(48);
  });
  it("allows only one of two simultaneous saves by different hiring units", async () => {
    await client.exec("DELETE FROM studio_human_interview_round");
    const input = {
      externalInterviewers: [{ name: "面试官", telegram: "interviewer" }],
      format: "online" as const,
      interviewerIds: [],
      label: "复面",
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const results = await Promise.allSettled(
      ["a", "b"].map((interviewRecordId) =>
        createHumanInterviewRound({ input, interviewRecordId, organizationId: "workspace" }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const saved = await client.query("SELECT id FROM studio_human_interview_round");
    expect(saved.rows).toHaveLength(1);
  });
});

it("saves and reads platform duration through the DAO", async () => {
  await client.exec("DELETE FROM platform_interview_config");
  expect(await loadPlatformInterviewConfig()).toEqual({ humanInterviewLockHours: 48 });
  expect(await savePlatformInterviewConfig({ humanInterviewLockHours: 24 })).toEqual({
    humanInterviewLockHours: 24,
  });
  expect(await loadPlatformInterviewConfig()).toEqual({ humanInterviewLockHours: 24 });
});

afterAll(() => client.close());
