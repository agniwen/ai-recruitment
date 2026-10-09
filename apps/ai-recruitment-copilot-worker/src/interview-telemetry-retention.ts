export function startInterviewTelemetryRetention() {
  let pending = false;
  async function run() {
    if (pending) {
      return;
    }
    pending = true;
    try {
      const { pruneInterviewTelemetry } =
        await import("@arc/ai-recruitment-copilot-backend/server/routes/public/routes/interview-telemetry/retention");
      await pruneInterviewTelemetry();
    } catch {
      console.warn("[interview-telemetry] retention cleanup failed");
    } finally {
      pending = false;
    }
  }
  const timer = setInterval(
    () => {
      void run();
    },
    60 * 60 * 1000,
  );
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
