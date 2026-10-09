import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHumanInterviewReminders } from "./human-interview-reminders";
const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn(),
  gate: vi.fn(),
  listen: vi.fn(),
  queueClose: vi.fn(),
  run: vi.fn(),
  sync: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@arc/resume-parse-queue/human-interview-reminders", () => ({
  closeHumanInterviewReminderQueue: mocks.queueClose,
  createHumanInterviewReminderWorker: mocks.create,
  waitForHumanInterviewReminderSend: mocks.gate,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/human-interview-reminders",
  () => ({ runHumanInterviewReminders: mocks.run }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-reminder-schedule",
  () => ({
    listenForHumanInterviewReminderChanges: mocks.listen,
    syncHumanInterviewReminderSchedules: mocks.sync,
  }),
);
let close: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
  vi.stubEnv("HUMAN_INTERVIEW_REMINDERS_ENABLED", "true");
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
  mocks.create.mockReturnValue({ close: mocks.close });
  mocks.listen.mockResolvedValue({ unlisten: mocks.unlisten });
  mocks.sync.mockResolvedValue(false);
  mocks.run.mockResolvedValue({ retry: false });
});
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("meeting reminder queue runtime", () => {
  it("dispatches outbox at startup, on committed changes, and on recovery ticks; sends only queue jobs", async () => {
    close = await startHumanInterviewReminders();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    const [[wake]] = mocks.listen.mock.calls;
    wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.sync).toHaveBeenCalledTimes(3);
    expect(mocks.run).not.toHaveBeenCalled();
    const job = { meetingId: "meeting", revision: 2 };
    await mocks.create.mock.calls[0][0](job);
    expect(mocks.run).toHaveBeenCalledWith(job, expect.any(Function), mocks.gate);
  });
  it("retains wakeups arriving during an active sync and drains bounded batches", async () => {
    const pending = Promise.withResolvers<boolean>();
    mocks.sync
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    close = await startHumanInterviewReminders();
    mocks.listen.mock.calls[0][0]();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    pending.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.sync).toHaveBeenCalledTimes(3);
  });
  it("retries incomplete deliveries through BullMQ", async () => {
    close = await startHumanInterviewReminders();
    mocks.run.mockResolvedValue({ retry: true });
    await expect(mocks.create.mock.calls[0][0]({ meetingId: "m", revision: 1 })).rejects.toThrow(
      "retry",
    );
  });
  it("recovers missed database notifications and shuts down before closing queue connections", async () => {
    mocks.listen.mockRejectedValue(new Error("offline"));
    close = await startHumanInterviewReminders();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    const stop = close;
    close = undefined;
    await stop();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.queueClose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
  it("waits for an active outbox sync before closing queue connections", async () => {
    const syncing = Promise.withResolvers<boolean>();
    mocks.sync.mockReturnValue(syncing.promise);
    close = await startHumanInterviewReminders();
    const stop = close;
    close = undefined;
    const closing = stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.close).not.toHaveBeenCalled();
    syncing.resolve(false);
    await closing;
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.queueClose).toHaveBeenCalledTimes(1);
  });
  it.each(["disabled", "no-tg", "no-redis"])("does not start with %s", async (mode) => {
    const flags = {
      disabled: "HUMAN_INTERVIEW_REMINDERS_ENABLED",
      "no-redis": "REDIS_URL",
      "no-tg": "TELEGRAM_BOT_TOKEN",
    } as const;
    vi.stubEnv(flags[mode as keyof typeof flags], mode === "disabled" ? "false" : "");
    close = await startHumanInterviewReminders();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
