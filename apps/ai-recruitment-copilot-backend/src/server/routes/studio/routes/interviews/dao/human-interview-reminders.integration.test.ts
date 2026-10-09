import { readFile } from "node:fs/promises";
import postgres from "postgres";
import type * as ReminderQueue from "@arc/resume-parse-queue/human-interview-reminders";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ReminderDao from "./human-interview-reminders";
import type * as RecipientDao from "./human-interview-reminder-recipients";
import type * as DeliveryDao from "./human-interview-reminder-delivery";
import type * as Reminders from "../utils/human-interview-reminders";

const post = vi.hoisted(() => vi.fn());
const queue = vi.hoisted(() => ({ ensure: vi.fn(), remove: vi.fn() }));
vi.mock("@arc/resume-parse-queue/human-interview-reminders", () => ({
  ensureHumanInterviewReminderJob: queue.ensure,
  removeHumanInterviewReminderJob: queue.remove,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot", () => ({
  isTelegramBotConfigured: () => true,
  postTelegramDirectMessage: post,
}));
const testUrl = process.env.HUMAN_INTERVIEW_REMINDER_TEST_DATABASE_URL;
const job = { meetingId: "meeting", revision: 1 };
const now = new Date("2026-10-09T01:50:00Z");

describe.skipIf(!testUrl)("human interview reminders in an isolated PostgreSQL database", () => {
  let sql: ReturnType<typeof postgres>;
  let dao: typeof ReminderDao;
  let recipients: typeof RecipientDao;
  let delivery: typeof DeliveryDao;
  let service: typeof Reminders;
  beforeAll(async () => {
    if (!testUrl || !new URL(testUrl).pathname.startsWith("/arc_reminder_test_")) {
      throw new Error("A dedicated arc_reminder_test_* database is required");
    }
    process.env.DATABASE_URL = testUrl;
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.test");
    vi.stubEnv("BETTER_AUTH_SECRET", "isolated-reminder-test-secret");
    sql = postgres(testUrl, { connection: { TimeZone: "Asia/Shanghai" } });
    await sql.unsafe(`
      CREATE TABLE organization (id text PRIMARY KEY, name text, slug text);
      CREATE TABLE "user" (id text PRIMARY KEY, telegram text, telegram_bound_username text, telegram_chat_id text);
      CREATE TABLE member (user_id text, organization_id text);
      CREATE TABLE job_description (id text PRIMARY KEY, organization_id text, name text, resume_contact text);
      CREATE TABLE studio_interview (id text PRIMARY KEY, organization_id text, candidate_name text, created_by text, job_description_id text, ai_review_assigned_odc_user_id text, pipeline_stage text DEFAULT 'human_interview', outcome text DEFAULT 'in_pipeline');
      CREATE TABLE studio_human_interview_round (id text PRIMARY KEY, interview_record_id text, organization_id text, label text, format text, location text, status text DEFAULT 'pending', scheduled_at timestamptz);
      CREATE TABLE studio_human_interview_meeting (id text PRIMARY KEY, organization_id text, status text DEFAULT 'scheduled', scheduled_at timestamptz, valid_until timestamptz);
      CREATE TABLE studio_human_interview_meeting_round (round_id text, meeting_id text REFERENCES studio_human_interview_meeting(id) ON DELETE CASCADE);
      CREATE TABLE studio_human_interview_meeting_interviewer (meeting_id text, user_id text, role text);
      CREATE TABLE studio_human_interview_round_interviewer (round_id text, user_id text);
      CREATE TABLE studio_interview_odc_assignment (interview_record_id text, user_id text);
      CREATE TABLE studio_human_interview_external_interviewer (id text PRIMARY KEY, round_id text, name text, telegram text, joined_at timestamptz, left_at timestamptz);
      CREATE TABLE telegram_recipient_binding (chat_id text PRIMARY KEY, username text UNIQUE);
      CREATE TABLE telegram_requester_binding (organization_id text, username text, chat_id text);
    `);
    await sql.unsafe(
      await readFile(
        new URL(
          "../../../../../../../../ai-recruitment-copilot/drizzle/20261009120000_add_human_interview_reminders/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    // Upgrade a pre-existing future meeting and successful round reminder, not just an empty DB.
    const legacyTime = new Date(Date.now() + 3_600_000);
    await sql`insert into studio_human_interview_round(id) values ('legacy-round')`;
    await sql`insert into studio_human_interview_meeting(id,organization_id,scheduled_at) values ('legacy-meeting','org',${legacyTime})`;
    await sql`insert into studio_human_interview_meeting_round values ('legacy-round','legacy-meeting')`;
    await sql`insert into studio_human_interview_reminder_delivery(round_id,scheduled_at,recipient_key,roles,status,last_attempt_at,sent_at)
      values ('legacy-round',${legacyTime},'chat:100','[]','sent',now(),now())`;
    await sql.unsafe(
      await readFile(
        new URL(
          "../../../../../../../../ai-recruitment-copilot/drizzle/20261009160000_meeting_reminder_queue/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    expect(
      await sql`select meeting_id,revision from studio_human_interview_reminder_schedule`,
    ).toMatchObject([{ meeting_id: "legacy-meeting", revision: 1 }]);
    expect(
      await sql`select meeting_id,status from studio_human_interview_meeting_reminder_delivery`,
    ).toMatchObject([{ meeting_id: "legacy-meeting", status: "sent" }]);
    dao = await import("./human-interview-reminders");
    recipients = await import("./human-interview-reminder-recipients");
    delivery = await import("./human-interview-reminder-delivery");
    service = await import("../utils/human-interview-reminders");
  });
  beforeEach(async () => {
    post.mockReset().mockResolvedValue(null);
    queue.ensure.mockReset().mockResolvedValue(null);
    queue.remove.mockReset().mockResolvedValue(null);
    await sql.unsafe(
      `TRUNCATE studio_human_interview_reminder_schedule, studio_human_interview_meeting_reminder_delivery, organization, "user", member, job_description, studio_interview, studio_human_interview_round, studio_human_interview_meeting, studio_human_interview_meeting_round, studio_human_interview_meeting_interviewer, studio_human_interview_round_interviewer, studio_interview_odc_assignment, studio_human_interview_external_interviewer, telegram_recipient_binding, telegram_requester_binding CASCADE`,
    );
    await sql.unsafe(`
      INSERT INTO organization VALUES ('org','测试公司','test');
      INSERT INTO "user" VALUES
        ('recruiter','@recruiter','recruiter','101'),
        ('contact','@contactuser','contactuser','102'),
        ('host','@hostuser','hostuser','103'),
        ('odc','@assignedodc','assignedodc','104'),
        ('legacy_odc','@legacyodc','legacyodc','105'),
        ('unbound','@unboundodc',NULL,NULL),
        ('outsider','@outsider','outsider','999');
      INSERT INTO member SELECT id, CASE WHEN id = 'outsider' THEN 'other' ELSE 'org' END FROM "user";
      INSERT INTO job_description VALUES ('jd','org','工程师','@contactuser');
      INSERT INTO studio_interview (id,organization_id,candidate_name,created_by,job_description_id,ai_review_assigned_odc_user_id) VALUES ('candidate','org','测试候选人','recruiter','jd','legacy_odc');
      INSERT INTO studio_human_interview_round (id,interview_record_id,organization_id,label,format,scheduled_at) VALUES ('round','candidate','org','技术面试','online','2026-10-09T02:00:00Z');
      INSERT INTO studio_human_interview_meeting (id,organization_id,scheduled_at) VALUES ('meeting','org','2026-10-09T02:00:00Z');
      INSERT INTO studio_human_interview_meeting_round VALUES ('round','meeting');
      INSERT INTO studio_human_interview_meeting_interviewer VALUES ('meeting','host','host'),('meeting','recruiter','interviewer');
      INSERT INTO studio_interview_odc_assignment VALUES ('candidate','odc'),('candidate','legacy_odc'),('candidate','unbound'),('candidate','recruiter'),('candidate','outsider');
      INSERT INTO studio_human_interview_external_interviewer (id,round_id,name,telegram) VALUES ('ext','round','外部面试官','@externaluser'),('ext_duplicate','round','同一面试官的外部登记','@hostuser');
      INSERT INTO telegram_recipient_binding VALUES ('106','externaluser');
    `);
  });
  afterAll(async () => {
    if (sql) {
      const { closeDatabase } = await import("@arc/ai-recruitment-copilot-backend/lib/server/db");
      await closeDatabase();
      await sql.end();
    }
    vi.unstubAllEnvs();
  });

  it("uses the exact ten-minute window and current meeting schedule", async () => {
    expect(await dao.loadHumanInterviewReminderRounds(job, new Date(now.getTime() - 1))).toEqual(
      [],
    );
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toHaveLength(1);
    expect(
      await dao.loadHumanInterviewReminderRounds(job, new Date("2026-10-09T02:00:00Z")),
    ).toEqual([]);
    await sql`update studio_human_interview_meeting set status='in_progress'`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toHaveLength(1);
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T02:30:00Z'`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
    await sql`update studio_human_interview_meeting set scheduled_at=null`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
  });
  it("repairs legacy UTC timestamps under Asia/Shanghai, invalidates old jobs and preserves successful deliveries", async () => {
    await sql.unsafe(`
      DROP TRIGGER human_interview_reminder_schedule_changed ON studio_human_interview_meeting;
      ALTER TABLE studio_human_interview_meeting ALTER COLUMN scheduled_at TYPE timestamp USING scheduled_at AT TIME ZONE 'UTC';
      CREATE TRIGGER human_interview_reminder_schedule_changed
        AFTER INSERT OR UPDATE OF scheduled_at, status OR DELETE ON studio_human_interview_meeting
        FOR EACH ROW EXECUTE FUNCTION sync_human_interview_reminder_schedule();
    `);
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09 02:01:00'`;
    const [broken] =
      await sql`select revision,scheduled_at from studio_human_interview_reminder_schedule`;
    expect(broken.scheduled_at.toISOString()).toBe("2026-10-08T18:01:00.000Z");
    await sql`update studio_human_interview_reminder_schedule set queued_revision=revision,next_sync_at=null`;
    await sql`insert into studio_human_interview_meeting_reminder_delivery(meeting_id,revision,recipient_key,round_ids,scheduled_at,chat_id,roles,status,attempts,last_attempt_at,sent_at)
      values ('meeting',${broken.revision},'chat:104','["round"]',${broken.scheduled_at},'104','["分配 ODC"]','sent',1,now(),now())`;
    const migration = await readFile(
      new URL(
        "../../../../../../../../ai-recruitment-copilot/drizzle/20261009230000_fix_meeting_reminder_timezone/migration.sql",
        import.meta.url,
      ),
      "utf-8",
    );
    await sql.unsafe(migration);
    const [fixed] =
      await sql`select revision,queued_revision,scheduled_at,next_sync_at from studio_human_interview_reminder_schedule`;
    expect(fixed.revision).toBe(broken.revision + 1);
    expect(fixed.queued_revision).toBe(broken.revision);
    expect(fixed.scheduled_at.toISOString()).toBe("2026-10-09T02:01:00.000Z");
    expect(fixed.next_sync_at).not.toBeNull();
    const clock = new Date("2026-10-09T01:51:00Z");
    expect(
      await dao.loadHumanInterviewReminderRounds({ ...job, revision: broken.revision }, clock),
    ).toEqual([]);
    const [reminder] = await dao.loadHumanInterviewReminderRounds(
      { ...job, revision: fixed.revision },
      clock,
    );
    expect(reminder.scheduledAt.toISOString()).toBe("2026-10-09T02:01:00.000Z");
    await service.runHumanInterviewReminders({ ...job, revision: fixed.revision }, () => clock);
    expect(post).toHaveBeenCalledTimes(5);
    expect(post.mock.calls.some(([chat]) => chat === "104")).toBe(false);
    await sql.unsafe(migration);
    const [repeated] = await sql`select revision from studio_human_interview_reminder_schedule`;
    expect(repeated.revision).toBe(fixed.revision);
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T03:00:00Z'`;
    const [rescheduled] =
      await sql`select scheduled_at from studio_human_interview_reminder_schedule`;
    expect(rescheduled.scheduled_at.toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });
  it("records why an expired meeting was removed instead of queued", async () => {
    const { syncHumanInterviewReminderSchedules } =
      await import("./human-interview-reminder-schedule");
    await sql`update studio_human_interview_reminder_schedule set next_sync_at=${now}`;
    await syncHumanInterviewReminderSchedules(new Date("2026-10-09T02:00:00Z"));
    expect(queue.ensure).not.toHaveBeenCalled();
    const [stopped] =
      await sql`select error_code,next_sync_at from studio_human_interview_reminder_schedule`;
    expect(stopped).toMatchObject({ error_code: "meeting_started", next_sync_at: null });
  });
  it.each(["cancelled", "ended"])("excludes %s meetings", async (status) => {
    await sql`update studio_human_interview_meeting set status=${status}`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
  });
  it.each(["cancelled", "completed"])("excludes %s rounds", async (status) => {
    await sql`update studio_human_interview_round set status=${status}`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
  });
  it("never falls back to a standalone round after deleting a meeting", async () => {
    await sql`delete from studio_human_interview_meeting`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
    await sql`update studio_interview set pipeline_stage='closed', outcome='rejected'`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
  });
  it("resolves both recruiting contacts, current interviewers, and assigned ODCs without duplicate chats or other workspace members", async () => {
    const [reminder] = await dao.loadHumanInterviewReminderRounds(job, now);
    const targets = await recipients.loadHumanInterviewReminderRecipients(reminder);
    expect(
      targets
        .map((row) => row.chatId)
        .filter(Boolean)
        .toSorted(),
    ).toEqual(["101", "102", "103", "104", "105", "106"]);
    expect(targets.find((row) => row.chatId === "101")?.roles).toEqual([
      "招聘人员",
      "面试官",
      "分配 ODC",
    ]);
    expect(targets.find((row) => row.chatId === "103")?.interviewer).toEqual({
      role: "host",
      userId: "host",
    });
    expect(targets.find((row) => row.chatId === "106")?.interviewer).toEqual({
      external: true,
      role: "interviewer",
      userId: "ext",
    });
    expect(targets.find((row) => row.key === "user:unbound")?.chatId).toBeNull();
  });
  it("persists successful sends across polls and concurrent workers, with a fresh reminder after rescheduling", async () => {
    await Promise.all([
      service.runHumanInterviewReminders(job, () => now),
      service.runHumanInterviewReminders(job, () => now),
    ]);
    expect(post).toHaveBeenCalledTimes(6);
    await service.runHumanInterviewReminders(job, () => now);
    expect(post).toHaveBeenCalledTimes(6);
    expect(
      await sql`select status,count(*)::int as count from studio_human_interview_meeting_reminder_delivery group by status order by status`,
    ).toEqual([
      { count: 6, status: "sent" },
      { count: 1, status: "unbound" },
    ]);
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T02:05:00Z'`;
    await service.runHumanInterviewReminders(
      { ...job, revision: 2 },
      () => new Date("2026-10-09T01:55:00Z"),
    );
    expect(post).toHaveBeenCalledTimes(12);
  });
  it("retries only failed recipients after the backoff", async () => {
    post.mockImplementation((chatId: string) => {
      if (chatId === "103") {
        throw new Error("Transient test failure");
      }
    });
    const first = await service.runHumanInterviewReminders(job, () => now);
    expect(first).toMatchObject({ failed: 1, sent: 5 });
    post.mockResolvedValue(null);
    await service.runHumanInterviewReminders(job, () => new Date(now.getTime() + 30_000));
    expect(post).toHaveBeenCalledTimes(6);
    await service.runHumanInterviewReminders(job, () => new Date(now.getTime() + 60_000));
    expect(post).toHaveBeenCalledTimes(7);
    expect(post).toHaveBeenLastCalledWith("103", expect.anything());
  });
  it("records missing bindings and sends after binding within the reminder window", async () => {
    await service.runHumanInterviewReminders(job, () => now);
    await sql`update "user" set telegram_bound_username='unboundodc', telegram_chat_id='107' where id='unbound'`;
    await service.runHumanInterviewReminders(job, () => new Date(now.getTime() + 30_000));
    expect(post).toHaveBeenCalledTimes(7);
    expect(post).toHaveBeenLastCalledWith("107", expect.anything());
  });
  it("claims atomically, recovers stale claims, rejects stale completion and caps attempts", async () => {
    const [reminder] = await dao.loadHumanInterviewReminderRounds(job, now);
    const target = { chatId: "104", key: "chat:104", roles: ["分配 ODC"] };
    const attempts = await Promise.all([
      delivery.claimHumanInterviewReminder([reminder], target, now),
      delivery.claimHumanInterviewReminder([reminder], target, now),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const later = new Date(now.getTime() + 120_000);
    const recovered = await delivery.claimHumanInterviewReminder([reminder], target, later);
    expect(recovered).toBeTruthy();
    const first = attempts.find((value) => value !== null);
    if (!first || !recovered) {
      throw new Error("Expected initial and recovered claims");
    }
    const finish = {
      now: later,
      recipientKey: target.key,
      ...job,
    };
    await delivery.finishHumanInterviewReminder({
      ...finish,
      attemptId: first,
      status: "sent",
    });
    const [record] = await sql`select status from studio_human_interview_meeting_reminder_delivery`;
    expect(record.status).toBe("sending");
    await delivery.finishHumanInterviewReminder({
      ...finish,
      attemptId: recovered,
      status: "failed",
    });
    const third = await delivery.claimHumanInterviewReminder(
      [reminder],
      target,
      new Date(later.getTime() + 60_000),
    );
    expect(third).toBeTruthy();
    if (!third) {
      throw new Error("Expected the third claim");
    }
    await delivery.finishHumanInterviewReminder({ ...finish, attemptId: third, status: "failed" });
    expect(
      await delivery.claimHumanInterviewReminder(
        [reminder],
        target,
        new Date(later.getTime() + 180_000),
      ),
    ).toBeNull();
  });
  it("versions schedule changes, including A-to-B-to-A, but keeps early entry on the same version", async () => {
    await sql`update studio_human_interview_meeting set status='in_progress'`;
    expect(
      await sql`select revision from studio_human_interview_reminder_schedule`.then(
        ([row]) => row.revision,
      ),
    ).toBe(1);
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T02:30:00Z'`;
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T02:00:00Z'`;
    expect(await dao.loadHumanInterviewReminderRounds(job, now)).toEqual([]);
    expect(await dao.loadHumanInterviewReminderRounds({ ...job, revision: 3 }, now)).toHaveLength(
      1,
    );
  });
  it("rolls back outbox changes with the meeting and notifies only after commit", async () => {
    const messages: string[] = [];
    const listener = await sql.listen("human_interview_reminder_changed", (value) =>
      messages.push(value),
    );
    try {
      await expect(
        sql.begin(async (tx) => {
          await tx`update studio_human_interview_meeting set scheduled_at=null`;
          expect(messages).toEqual([]);
          throw new Error("rollback-test");
        }),
      ).rejects.toThrow("rollback-test");
      expect(
        await sql`select revision from studio_human_interview_reminder_schedule`.then(
          ([row]) => row.revision,
        ),
      ).toBe(1);
      await sql`update studio_human_interview_meeting set scheduled_at=null`;
      await expect.poll(() => messages).toContain("meeting");
      expect(
        await sql`select active from studio_human_interview_reminder_schedule`.then(
          ([row]) => row.active,
        ),
      ).toBe(false);
    } finally {
      await listener.unlisten();
    }
  });
  it("keeps delivery evidence after deletion and never sends from a leftover round", async () => {
    await service.runHumanInterviewReminders(job, () => now);
    await sql`delete from studio_human_interview_meeting`;
    expect(
      await sql`select active,revision from studio_human_interview_reminder_schedule`.then(
        ([row]) => row,
      ),
    ).toMatchObject({ active: false, revision: 2 });
    await service.runHumanInterviewReminders(job, () => now);
    expect(post).toHaveBeenCalledTimes(6);
    expect(
      await sql`select count(*)::int as count from studio_human_interview_meeting_reminder_delivery`.then(
        ([row]) => row.count,
      ),
    ).toBe(7);
  });
  it("merges a multi-candidate meeting by recipient without exposing unrelated candidates", async () => {
    await sql.unsafe(`
      INSERT INTO "user" VALUES ('owner2','@owner2','owner2','107');
      INSERT INTO member VALUES ('owner2','org');
      INSERT INTO studio_interview (id,organization_id,candidate_name,created_by) VALUES ('candidate2','org','第二位候选人','owner2');
      INSERT INTO studio_human_interview_round (id,interview_record_id,organization_id,label,format) VALUES ('round2','candidate2','org','技术二面','online');
      INSERT INTO studio_human_interview_meeting_round VALUES ('round2','meeting');
    `);
    await service.runHumanInterviewReminders(job, () => now);
    const { calls } = post.mock;
    expect(calls.filter(([id]) => id === "103")).toHaveLength(1);
    expect(JSON.stringify(calls.find(([id]) => id === "103")?.[1])).toContain("第二位候选人");
    expect(JSON.stringify(calls.find(([id]) => id === "105")?.[1])).not.toContain("第二位候选人");
    expect(JSON.stringify(calls.find(([id]) => id === "107")?.[1])).not.toContain("测试候选人");
  });
  it("retries outbox failures and cannot acknowledge a concurrently changed schedule", async () => {
    const { syncHumanInterviewReminderSchedules } =
      await import("./human-interview-reminder-schedule");
    await sql`update studio_human_interview_reminder_schedule set next_sync_at=${now}`;
    queue.ensure.mockRejectedValueOnce(new Error("Redis offline"));
    await syncHumanInterviewReminderSchedules(now);
    expect(
      await sql`select error_code from studio_human_interview_reminder_schedule`.then(
        ([row]) => row.error_code,
      ),
    ).toBe("queue_sync_failed");
    queue.ensure.mockImplementationOnce(async () => {
      await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T03:00:00Z'`;
    });
    await syncHumanInterviewReminderSchedules(new Date(now.getTime() + 60_000));
    const [schedule] =
      await sql`select revision,queued_revision,next_sync_at from studio_human_interview_reminder_schedule`;
    expect(schedule.revision).toBe(2);
    expect(schedule.queued_revision).toBeNull();
    expect(schedule.next_sync_at).not.toBeNull();
  });
  it("cleans old jobs on reschedule/deletion and repairs a missed job from the indexed outbox", async () => {
    const { syncHumanInterviewReminderSchedules } =
      await import("./human-interview-reminder-schedule");
    await sql`update studio_human_interview_reminder_schedule set next_sync_at=${now}`;
    await syncHumanInterviewReminderSchedules(now);
    expect(queue.ensure).toHaveBeenCalledTimes(1);
    await syncHumanInterviewReminderSchedules(new Date(now.getTime() + 120_000));
    expect(queue.ensure).toHaveBeenCalledTimes(2);
    await sql`update studio_human_interview_meeting set scheduled_at='2026-10-09T03:00:00Z'`;
    await sql`update studio_human_interview_reminder_schedule set next_sync_at=${now}`;
    await syncHumanInterviewReminderSchedules(now);
    expect(queue.remove).toHaveBeenCalledWith(job);
    expect(queue.ensure).toHaveBeenLastCalledWith(
      expect.objectContaining({ meetingId: "meeting", revision: 2 }),
      new Date("2026-10-09T03:00:00Z"),
    );
    await sql`delete from studio_human_interview_meeting`;
    await sql`update studio_human_interview_reminder_schedule set next_sync_at=${now}`;
    await syncHumanInterviewReminderSchedules(now);
    expect(queue.remove).toHaveBeenCalledWith({ ...job, revision: 2 });
    expect(
      await sql`select next_sync_at from studio_human_interview_reminder_schedule`.then(
        ([row]) => row.next_sync_at,
      ),
    ).toBeNull();
  });

  it.skipIf(!process.env.HUMAN_INTERVIEW_REMINDER_TEST_REDIS_URL)(
    "delivers a committed meeting through PostgreSQL NOTIFY and real BullMQ, then cancels a replacement",
    async () => {
      const redisUrl = process.env.HUMAN_INTERVIEW_REMINDER_TEST_REDIS_URL;
      if (!redisUrl || new URL(redisUrl).hostname !== "127.0.0.1") {
        throw new Error("Local Redis required");
      }
      vi.stubEnv("REDIS_URL", redisUrl);
      vi.stubEnv("RESUME_PARSE_QUEUE_PREFIX", `arc-reminder-test-${crypto.randomUUID()}`);
      const actual = await vi.importActual<typeof ReminderQueue>(
        "@arc/resume-parse-queue/human-interview-reminders",
      );
      const schedules = await import("./human-interview-reminder-schedule");
      queue.ensure.mockImplementation(actual.ensureHumanInterviewReminderJob);
      queue.remove.mockImplementation(actual.removeHumanInterviewReminderJob);
      await sql`delete from studio_interview_odc_assignment where user_id='unbound'`;
      const worker = actual.createHumanInterviewReminderWorker(async (data) => {
        const result = await service.runHumanInterviewReminders(
          data,
          () => new Date(),
          actual.waitForHumanInterviewReminderSend,
        );
        if (result.retry) {
          throw new Error("retry");
        }
      });
      let pending = Promise.resolve();
      const listener = await schedules.listenForHumanInterviewReminderChanges(() => {
        pending = pending.then(async () => {
          await schedules.syncHumanInterviewReminderSchedules();
        });
      });
      try {
        await worker.waitUntilReady();
        const start = new Date(Date.now() + 10 * 60_000 + 400);
        await sql`update studio_human_interview_meeting set scheduled_at=${start}`;
        await expect.poll(() => post.mock.calls.length, { timeout: 10_000 }).toBe(6);
        await expect
          .poll(
            async () =>
              await sql`select next_sync_at from studio_human_interview_reminder_schedule`.then(
                ([row]) => row.next_sync_at,
              ),
          )
          .toBeNull();
        await sql`update studio_human_interview_meeting set scheduled_at=${new Date(Date.now() + 3_600_000)}`;
        const replacement = { meetingId: "meeting", revision: 3 };
        await expect
          .poll(async () =>
            Boolean(
              await actual
                .getHumanInterviewReminderQueue()
                .getJob(actual.humanInterviewReminderJobId(replacement)),
            ),
          )
          .toBe(true);
        await sql`delete from studio_human_interview_meeting`;
        await expect
          .poll(async () =>
            Boolean(
              await actual
                .getHumanInterviewReminderQueue()
                .getJob(actual.humanInterviewReminderJobId(replacement)),
            ),
          )
          .toBe(false);
        expect(post).toHaveBeenCalledTimes(6);
      } finally {
        await listener.unlisten();
        await pending;
        await worker.close();
        await actual.getHumanInterviewReminderQueue().obliterate({ force: true });
        await actual.closeHumanInterviewReminderQueue();
      }
    },
  );
});
