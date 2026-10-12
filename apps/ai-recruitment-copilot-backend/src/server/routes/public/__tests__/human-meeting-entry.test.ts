import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { publicRouter } from "../route";

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  proof: vi.fn(),
  resolve: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("../routes/entry-credentials/policy", () => ({
  checkCandidateEntryProof: mocks.proof,
  getCandidateEntryPolicy: mocks.policy,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-meetings",
  async () => {
    const access =
      await import("../../studio/routes/interviews/dao/human-interview-meeting-access");
    return {
      ...access,
      endHumanInterviewMeeting: vi.fn(),
      resolveHumanInterviewMeetingInterviewerInviteToken: mocks.resolve,
      resolveHumanInterviewMeetingInviteToken: mocks.resolve,
    };
  },
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/human-interview-livekit",
  () => ({
    HumanInterviewLiveKitConfigError: class extends Error {},
    deleteHumanInterviewLiveKitRoom: vi.fn(),
    signHumanInterviewMeetingToken: mocks.sign,
  }),
);
vi.mock("../routes/interview-telemetry/dao", () => ({
  recordServerTelemetrySafely: vi.fn(),
  resolveTelemetryScope: vi.fn(),
  saveClientEvents: vi.fn(),
}));
const app = factory.createApp().route("/public", publicRouter);
const scope = {
  candidateName: "测试候选人",
  interviewerName: "测试面试官",
  liveKitRoomName: "room",
  meetingId: "meeting",
  role: "interviewer",
  roundLabel: "一面",
  scheduledAt: "2026-09-30T08:00:00.000Z",
  status: "scheduled",
  title: "时区测试",
  validUntil: "2026-09-30T09:00:00.000Z",
};
beforeEach(() => {
  mocks.policy.mockResolvedValue({ required: false });
  mocks.proof.mockResolvedValue({ allowed: true, credentialRef: null });
  mocks.resolve.mockResolvedValue(scope);
  mocks.sign.mockResolvedValue({ participantToken: "test-token" });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T07:49:59.000Z"));
});

describe("candidate-only credential enforcement", () => {
  beforeEach(() => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-30T07:50:00.000Z"));
  });
  it("rejects missing/invalid proof before signing a candidate token", async () => {
    mocks.proof.mockResolvedValue({ allowed: false });
    const result = await app.request("/public/human-interview-meetings/invite/livekit-token", {
      method: "POST",
    });
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: "ENTRY_CREDENTIAL_REQUIRED" });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("never applies the candidate gate to interviewer links", async () => {
    mocks.proof.mockResolvedValue({ allowed: false });
    const result = await app.request(
      "/public/human-interview-meetings/interviewer/invite/livekit-token",
      { method: "POST" },
    );
    expect(result.status).toBe(200);
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(mocks.policy).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe.each([
  "/public/human-interview-meetings/invite",
  "/public/human-interview-meetings/interviewer/invite",
])("meeting entry %s", (path) => {
  it("returns uncached server access and still rejects token requests before opening", async () => {
    const response = await app.request(path);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.entryAccess).toEqual({
      canJoin: false,
      reason: "too_early",
      recheckAfterMs: 1000,
    });
    const tokenResponse = await app.request(`${path}/livekit-token`, { method: "POST" });
    expect(tokenResponse.status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("opens exactly at 15:50 Beijing / 14:50 Vietnam and issues a token", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-30T07:50:00.000Z"));
    const response = await app.request(path);
    const body = await response.json();
    expect(body.entryAccess.canJoin).toBe(true);
    const tokenResponse = await app.request(`${path}/livekit-token`, { method: "POST" });
    expect(tokenResponse.status).toBe(200);
  });
  it("does not expose meeting data for invalid invitations", async () => {
    mocks.resolve.mockResolvedValue(null);
    const response = await app.request(path);
    expect(response.status).toBe(404);
  });
  it.each(["ended", "cancelled"])(
    "blocks %s meetings in both preview and token routes",
    async (status) => {
      mocks.resolve.mockResolvedValue({ ...scope, status });
      const response = await app.request(path);
      const body = await response.json();
      expect(body.entryAccess.reason).toBe("closed");
      const tokenResponse = await app.request(`${path}/livekit-token`, { method: "POST" });
      expect(tokenResponse.status).toBe(403);
    },
  );
});
