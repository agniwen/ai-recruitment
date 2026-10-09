export async function startHumanInterviewReminders() {
  const disabled = ["false", "0", "no"].includes(
    process.env.HUMAN_INTERVIEW_REMINDERS_ENABLED?.trim().toLowerCase() ?? "",
  );
  if (
    disabled ||
    !process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    !process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim()
  ) {
    console.info("[human-interview-reminders] disabled or Telegram is not configured");
    return () => Promise.resolve();
  }
  if (!process.env.REDIS_URL?.trim()) {
    console.error("[human-interview-reminders] REDIS_URL is required; outbox remains pending");
    return () => Promise.resolve();
  }
  const {
    createHumanInterviewReminderWorker,
    closeHumanInterviewReminderQueue,
    waitForHumanInterviewReminderSend,
  } = await import("@arc/resume-parse-queue/human-interview-reminders");
  const { syncHumanInterviewReminderSchedules, listenForHumanInterviewReminderChanges } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-reminder-schedule");
  const { runHumanInterviewReminders } =
    await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/human-interview-reminders");
  const worker = createHumanInterviewReminderWorker(async (job) => {
    const result = await runHumanInterviewReminders(
      job,
      () => new Date(),
      waitForHumanInterviewReminderSend,
    );
    console.info("[human-interview-reminders] job processed", { ...job, ...result });
    if (result.retry) {
      throw new Error("Reminder recipients are awaiting retry or Telegram binding");
    }
  });
  let closed = false;
  let requested = false;
  let pending: Promise<void> | null = null;
  const wake = () => {
    if (closed) {
      return;
    }
    requested = true;
    if (pending) {
      return;
    }
    pending = (async () => {
      try {
        while (requested) {
          if (closed) {
            break;
          }
          requested = false;
          if (await syncHumanInterviewReminderSchedules()) {
            requested = true;
          }
        }
      } catch {
        console.error("[human-interview-reminders] outbox unavailable; will retry");
      } finally {
        pending = null;
      }
    })();
  };
  // NOTIFY handles normal commits immediately; this indexed outbox check repairs missed signals.
  const timer = setInterval(wake, 60_000);
  timer.unref();
  let listener: { unlisten: () => Promise<void> } | undefined;
  try {
    listener = await listenForHumanInterviewReminderChanges(wake);
  } catch {
    console.error(
      "[human-interview-reminders] database notifications unavailable; using outbox recovery",
    );
  }
  wake();
  return async () => {
    closed = true;
    clearInterval(timer);
    await listener?.unlisten();
    await pending;
    await worker.close();
    await closeHumanInterviewReminderQueue();
  };
}
