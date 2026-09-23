import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanInterviewMeetingRecord } from "@arc/shared/studio-pipeline-stages";
import { notifyExternalInterviewers } from "./external-interviewer-notification";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), resolve: vi.fn(), send: vi.fn() }));
vi.mock("../dao/external-interviewers", () => ({
  resolveExternalInterviewerBindings: mocks.resolve,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot", () => ({
  isTelegramBotConfigured: mocks.configured,
  postTelegramDirectMessage: mocks.send,
}));
const meeting = {
  id: "meeting",
  interviewers: [
    { external: true, id: "external-a", name: "张三", telegram: "@tester1" },
    { external: true, id: "external-b", name: "李四", telegram: "" },
    { id: "internal", name: "成员" },
  ],
  organizationId: "org",
  scheduledAt: "2026-10-01T01:00:00Z",
  title: "技术面试",
} as HumanInterviewMeetingRecord;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
  mocks.configured.mockReturnValue(true);
  mocks.resolve.mockResolvedValue([
    { chatId: "123", name: "张三", telegram: "@tester1" },
    { chatId: null, name: "李四", telegram: "" },
  ]);
  mocks.send.mockResolvedValue(null);
});
describe("external interviewer notifications", () => {
  it("sends only bound external interviewers their own signed invitation", async () => {
    expect(await notifyExternalInterviewers(meeting)).toEqual([]);
    expect(mocks.resolve).toHaveBeenCalledWith("org", [
      { name: "张三", telegram: "@tester1" },
      { name: "李四", telegram: "" },
    ]);
    expect(mocks.send).toHaveBeenCalledOnce();
    const [[chatId, text]] = mocks.send.mock.calls;
    expect(chatId).toBe("123");
    expect(text).toContain("https://example.com/human-interview/interviewer/");
    const [, token] = text.match(/interviewer\/([^\n]+)/u);
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(payload).toMatchObject({
      external: true,
      meetingId: "meeting",
      role: "interviewer",
      userId: "external-a",
    });
  });
  it("reports send failures without failing the saved meeting", async () => {
    mocks.send.mockRejectedValue(new Error("provider down"));
    expect(await notifyExternalInterviewers(meeting)).toEqual(["张三"]);
  });
  it("reports configuration or lookup failures without throwing", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await notifyExternalInterviewers(meeting)).toEqual(["张三"]);
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.resolve.mockRejectedValue(new Error("DB down"));
    expect(await notifyExternalInterviewers(meeting)).toEqual(["张三", "李四"]);
  });
});
