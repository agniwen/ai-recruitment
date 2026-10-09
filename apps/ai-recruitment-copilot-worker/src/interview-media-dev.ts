import process from "node:process";
// A local sampler only: never starts Telegram, resume processing, or other Worker jobs.
const database = new URL(process.env.DATABASE_URL ?? "");
const livekit = new URL(process.env.LIVEKIT_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !["localhost", "127.0.0.1"].includes(livekit.hostname) ||
  !process.env.INTERVIEW_MEDIA_LOCAL_DIR
) {
  throw new Error(
    "Local sampler requires local PostgreSQL, local LiveKit and INTERVIEW_MEDIA_LOCAL_DIR",
  );
}
process.env.HUMAN_INTERVIEW_MEDIA_ENABLED = "true";
const { startInterviewMedia } = await import("./interview-media");
const { closeDatabase } = await import("@arc/ai-recruitment-copilot-backend/lib/server/db");
const { dispose } = await import("@livekit/rtc-node");
const stop = await startInterviewMedia();
console.info("[interview-media] local-only sampler started");
let closing = false;
async function shutdown() {
  if (closing) {
    return;
  }
  closing = true;
  try {
    await stop();
    await closeDatabase();
  } finally {
    dispose();
  }
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
