import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  humanInterviewReminderJobId,
  humanInterviewReminderJobSchema,
  ensureHumanInterviewReminderJob,
  removeHumanInterviewReminderJob,
  getHumanInterviewReminderQueue,
  createHumanInterviewReminderWorker,
  closeHumanInterviewReminderQueue,
  waitForHumanInterviewReminderSend,
} from "./human-interview-reminders";

it("identifies jobs by meeting and version without separator collisions", () => {
  expect(humanInterviewReminderJobId({ meetingId: "a:b", revision: 1 })).not.toBe(
    humanInterviewReminderJobId({ meetingId: "a-b", revision: 1 }),
  );
  expect(humanInterviewReminderJobId({ meetingId: "m", revision: 1 })).not.toContain(":");
  expect(humanInterviewReminderJobSchema.safeParse({ meetingId: "m", revision: 0 }).success).toBe(
    false,
  );
});
const url = process.env.HUMAN_INTERVIEW_REMINDER_TEST_REDIS_URL;
describe.skipIf(!url)("meeting reminder queue against isolated Redis", () => {
  let worker: ReturnType<typeof createHumanInterviewReminderWorker> | undefined;
  beforeEach(() => {
    if (!url || new URL(url).hostname !== "127.0.0.1") {
      throw new Error("Only isolated local Redis is allowed");
    }
    vi.stubEnv("REDIS_URL", url);
    vi.stubEnv("RESUME_PARSE_QUEUE_PREFIX", `arc-reminder-test-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await getHumanInterviewReminderQueue().obliterate({ force: true });
    await closeHumanInterviewReminderQueue();
    vi.unstubAllEnvs();
  });
  it("creates one delayed job under concurrent enqueue and replaces a rescheduled job", async () => {
    const job = { meetingId: "meeting", revision: 1 };
    const time = new Date(Date.now() + 3_600_000);
    await Promise.all([
      ensureHumanInterviewReminderJob(job, time),
      ensureHumanInterviewReminderJob(job, time),
    ]);
    expect(await getHumanInterviewReminderQueue().getJobCounts("delayed")).toMatchObject({
      delayed: 1,
    });
    const queued = await getHumanInterviewReminderQueue().getJob(humanInterviewReminderJobId(job));
    expect(queued?.delay).toBeGreaterThan(2_990_000);
    await removeHumanInterviewReminderJob(job);
    await ensureHumanInterviewReminderJob({ ...job, revision: 2 }, time);
    expect(
      await getHumanInterviewReminderQueue().getJob(humanInterviewReminderJobId(job)),
    ).toBeUndefined();
    expect(await getHumanInterviewReminderQueue().getJobCounts("delayed")).toMatchObject({
      delayed: 1,
    });
  });
  it("executes at the reminder time and restores a missing Redis job", async () => {
    const job = { meetingId: "meeting", revision: 1 };
    const processed: unknown[] = [];
    worker = createHumanInterviewReminderWorker((data) => {
      processed.push(data);
      return Promise.resolve();
    });
    await worker.waitUntilReady();
    const startAt = Date.now() + 10 * 60_000 + 350;
    await ensureHumanInterviewReminderJob(job, new Date(startAt));
    await removeHumanInterviewReminderJob(job);
    await ensureHumanInterviewReminderJob(job, new Date(startAt));
    expect(processed).toEqual([]);
    await expect.poll(() => processed, { timeout: 5000 }).toEqual([job]);
    expect(Date.now()).toBeGreaterThanOrEqual(startAt - 10 * 60_000);
  });
  it("leaves active old jobs to the persisted version check and schedules a new version independently", async () => {
    const release = Promise.withResolvers<boolean>();
    const old = { meetingId: "meeting", revision: 1 };
    const started: unknown[] = [];
    worker = createHumanInterviewReminderWorker(async (data) => {
      started.push(data);
      await release.promise;
    });
    await worker.waitUntilReady();
    try {
      await ensureHumanInterviewReminderJob(old, new Date(Date.now() + 60_000));
      await expect.poll(() => started).toHaveLength(1);
      await expect(removeHumanInterviewReminderJob(old)).resolves.toBeUndefined();
      await ensureHumanInterviewReminderJob(
        { ...old, revision: 2 },
        new Date(Date.now() + 3_600_000),
      );
      expect(
        await getHumanInterviewReminderQueue().getJobCounts("active", "delayed"),
      ).toMatchObject({ active: 1, delayed: 1 });
    } finally {
      release.resolve(true);
    }
  });
  it("backs off delivery failures rather than immediately spinning", async () => {
    worker = createHumanInterviewReminderWorker(() =>
      Promise.reject(new Error("test delivery failure")),
    );
    await worker.waitUntilReady();
    const data = { meetingId: "failure", revision: 1 };
    await ensureHumanInterviewReminderJob(data, new Date(Date.now() + 60_000));
    await expect
      .poll(async () => {
        const queued = await getHumanInterviewReminderQueue().getJob(
          humanInterviewReminderJobId(data),
        );
        return queued?.attemptsMade;
      })
      .toBe(1);
    const queued = await getHumanInterviewReminderQueue().getJob(humanInterviewReminderJobId(data));
    expect(await queued?.getState()).toBe("delayed");
    expect(queued?.delay).toBe(60_000);
  });
  it("shares a per-chat send limit across concurrent processors", async () => {
    const begin = Date.now();
    await Promise.all([
      waitForHumanInterviewReminderSend("same-chat"),
      waitForHumanInterviewReminderSend("same-chat"),
    ]);
    expect(Date.now() - begin).toBeGreaterThanOrEqual(950);
  });
});
