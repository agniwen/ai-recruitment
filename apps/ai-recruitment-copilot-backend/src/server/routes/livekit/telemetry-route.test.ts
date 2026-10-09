import { createHash } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { livekitRouter } from "./route";
import { saveLiveKitTelemetry } from "./telemetry";
import {
  MEDIA_RECORDER_IDENTITY,
  signalMediaRoom,
} from "../platform/routes/interview-logs/routes/media/capture";
import { markHumanInterviewParticipantJoined } from "../studio/routes/interviews/dao/human-interview-meetings";

vi.mock("../platform/routes/interview-logs/routes/media/capture", () => ({
  MEDIA_RECORDER_IDENTITY: "arc_interview_media_recorder",
  signalMediaRoom: vi.fn(),
}));

vi.mock("./telemetry", () => ({ saveLiveKitTelemetry: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  cacheTags: {},
  safeUpdateTag: vi.fn(),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-meetings",
  () => ({
    endHumanInterviewMeetingByRoomName: vi.fn(),
    markHumanInterviewMeetingInProgressByRoomName: vi.fn(),
    markHumanInterviewParticipantJoined: vi.fn(),
    markHumanInterviewParticipantLeft: vi.fn(),
  }),
);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LIVEKIT_API_KEY", "test-key");
  vi.stubEnv("LIVEKIT_API_SECRET", "test-secret-for-signatures-only");
  vi.mocked(saveLiveKitTelemetry).mockResolvedValue();
});
afterEach(() => vi.unstubAllEnvs());
async function request(tamper = false, event = "participant_left", identity = "candidate_round") {
  const body = JSON.stringify({
    createdAt: String(Math.floor(Date.now() / 1000)),
    event,
    id: "EV_1",
    participant: { identity, sid: "PA_1" },
    room: { name: "human_test", sid: "RM_1" },
  });
  const token = new AccessToken("test-key", "test-secret-for-signatures-only");
  token.sha256 = createHash("sha256").update(body).digest("base64");
  return new Request("https://example.test/webhook", {
    body: tamper ? `${body} ` : body,
    headers: { Authorization: await token.toJwt(), "Content-Type": "application/webhook+json" },
    method: "POST",
  });
}
describe("signed LiveKit telemetry boundary", () => {
  it("rejects changed webhook bodies before saving evidence", async () => {
    const response = await livekitRouter.request(await request(true));
    expect(response.status).toBe(401);
    expect(saveLiveKitTelemetry).not.toHaveBeenCalled();
  });
  it("accepts verified events and returns 503 to trigger retry on storage failure", async () => {
    const response = await livekitRouter.request(await request());
    expect(response.status).toBe(200);
    expect(saveLiveKitTelemetry).toHaveBeenCalledWith(expect.objectContaining({ id: "EV_1" }));
    vi.mocked(saveLiveKitTelemetry).mockRejectedValueOnce(new Error("storage private data"));
    const failure = await livekitRouter.request(await request());
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("private data");
  });
  it("wakes the media worker only after signature verification and retries a failed durable signal", async () => {
    const joined = await livekitRouter.request(await request(false, "participant_joined"));
    expect(joined.status).toBe(200);
    expect(signalMediaRoom).toHaveBeenCalledWith("human_test", "RM_1", false);
    vi.mocked(signalMediaRoom).mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await livekitRouter.request(await request(false, "participant_joined"));
    expect(failed.status).toBe(503);
  });
  it("excludes the private sampler from business participant lifecycle and wakeups", async () => {
    const response = await livekitRouter.request(
      await request(false, "participant_joined", MEDIA_RECORDER_IDENTITY),
    );
    expect(response.status).toBe(200);
    expect(markHumanInterviewParticipantJoined).not.toHaveBeenCalled();
    expect(signalMediaRoom).not.toHaveBeenCalled();
  });
});
