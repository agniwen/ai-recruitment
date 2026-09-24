import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanInterviewMeetingRecord } from "@arc/shared/studio-pipeline-stages";
import { notifyExternalInterviewers } from "./external-interviewer-notification";
const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  configured: vi.fn(),
  resolve: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../dao/external-interviewers", () => ({
  loadExternalInterviewCandidates: mocks.candidates,
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
  mocks.candidates.mockResolvedValue([
    {
      candidateName: "Alex",
      departmentName: "效能部",
      hiringUnitName: "研发中心",
      id: "candidate-1",
      jobDescriptionName: "工程师",
      organizationSlug: "work",
    },
  ]);
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
    const [[chatId, card]] = mocks.send.mock.calls;
    expect(chatId).toBe("123");
    expect(card).toMatchObject({ title: "真人面试邀请", type: "card" });
    const action = card.children.find((child: { type: string }) => child.type === "actions");
    expect(action.children).toEqual([
      {
        label: "进入面试",
        type: "link-button",
        url: expect.stringMatching(/^https:\/\/example\.com\/human-interview\/interviewer\//u),
      },
      {
        label: "查看候选人详情",
        type: "link-button",
        url: "https://example.com/resume-review/work/candidate-1",
      },
    ]);
    expect(card.children).toContainEqual({
      children: [
        { label: "候选人", type: "field", value: "Alex" },
        { label: "岗位", type: "field", value: "工程师" },
        { label: "用人组织", type: "field", value: "研发中心" },
        { label: "部门", type: "field", value: "效能部" },
      ],
      type: "fields",
    });
    const token = decodeURIComponent(
      new URL(action.children[0].url).pathname.split("/").at(-1) ?? "",
    );
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
