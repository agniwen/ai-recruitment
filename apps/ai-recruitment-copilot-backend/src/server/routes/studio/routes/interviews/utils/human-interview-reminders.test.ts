import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanInterviewReminder } from "../dao/human-interview-reminders";
import type { HumanInterviewReminderRecipient } from "../dao/human-interview-reminder-recipients";
import type * as RecipientModule from "../dao/human-interview-reminder-recipients";
import { mergeReminderRecipients } from "../dao/human-interview-reminder-recipients";
import { verifyInterviewerInviteToken } from "../dao/human-interview-meeting-access";
import { buildHumanInterviewReminderMessage } from "./human-interview-reminder-message";
import { runHumanInterviewReminders } from "./human-interview-reminders";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  configured: vi.fn(),
  due: vi.fn(),
  finish: vi.fn(),
  post: vi.fn(),
  recipients: vi.fn(),
  retryable: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot", () => ({
  isTelegramBotConfigured: mocks.configured,
  postTelegramDirectMessage: mocks.post,
}));
vi.mock("../dao/human-interview-reminders", () => ({
  loadHumanInterviewReminderRounds: mocks.due,
}));
vi.mock("../dao/human-interview-reminder-recipients", async (importOriginal) => ({
  ...(await importOriginal<typeof RecipientModule>()),
  loadHumanInterviewReminderRecipients: mocks.recipients,
}));
vi.mock("../dao/human-interview-reminder-delivery", () => ({
  claimHumanInterviewReminder: mocks.claim,
  finishHumanInterviewReminder: mocks.finish,
  hasRetryableHumanInterviewReminder: mocks.retryable,
}));

vi.mock("../dao/human-interview-reminder-schedule", () => ({
  completeHumanInterviewReminderSchedule: mocks.complete,
}));
const job = { meetingId: "meeting", revision: 1 };
const now = new Date("2026-10-09T01:50:00Z");
const reminder: HumanInterviewReminder = {
  assignedOdcUserId: "odc",
  candidateId: "candidate",
  candidateName: "测试候选人",
  creatorId: "recruiter",
  format: "online",
  jobName: "工程师",
  location: null,
  meetingId: "meeting",
  organizationId: "org",
  organizationName: "测试公司",
  organizationSlug: "test",
  resumeContact: null,
  revision: 1,
  roundId: "round",
  scheduledAt: new Date("2026-10-09T02:00:00Z"),
  title: "技术面试",
};
const recipient: HumanInterviewReminderRecipient = {
  chatId: "123",
  key: "chat:123",
  roles: ["招聘人员"],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "reminder-test-secret");
  mocks.configured.mockReturnValue(true);
  mocks.retryable.mockResolvedValue(false);
  mocks.due.mockResolvedValue([reminder]);
  mocks.recipients.mockResolvedValue([recipient]);
  mocks.claim.mockResolvedValue("attempt");
  mocks.finish.mockResolvedValue(null);
  mocks.post.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("human interview reminder delivery", () => {
  it("sends the due reminder and persists its success", async () => {
    expect(await runHumanInterviewReminders(job, () => now)).toEqual({
      failed: 0,
      retry: false,
      sent: 1,
      skipped: 0,
      unbound: 0,
    });
    expect(mocks.post).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ title: "⏰ 真人面试即将开始" }),
    );
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "attempt", status: "sent" }),
    );
  });
  it("does not send a delivery already claimed or completed by another worker", async () => {
    mocks.claim.mockResolvedValue(null);
    expect(await runHumanInterviewReminders(job, () => now)).toMatchObject({ skipped: 1 });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("rechecks cancelled or rescheduled work before sending", async () => {
    mocks.due.mockResolvedValueOnce([reminder]).mockResolvedValueOnce([]);
    expect(await runHumanInterviewReminders(job, () => now)).toMatchObject({ skipped: 1 });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "schedule_or_recipient_changed", status: "skipped" }),
    );
  });
  it("skips a removed recipient and never reuses their old invite", async () => {
    mocks.recipients.mockResolvedValueOnce([recipient]).mockResolvedValueOnce([]);
    await runHumanInterviewReminders(job, () => now);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("does not send after the scheduled start passes during preparation", async () => {
    await runHumanInterviewReminders(job, () => reminder.scheduledAt);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("records one recipient's failure and still notifies the others", async () => {
    mocks.recipients.mockResolvedValue([
      recipient,
      { ...recipient, chatId: "456", key: "chat:456" },
    ]);
    mocks.post.mockRejectedValueOnce(new Error("Telegram unavailable"));
    expect(await runHumanInterviewReminders(job, () => now)).toMatchObject({ failed: 1, sent: 1 });
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "telegram_delivery_failed", status: "failed" }),
    );
  });
  it("records unbound targets without attempting a Telegram username DM", async () => {
    mocks.recipients.mockResolvedValue([{ ...recipient, chatId: null, key: "user:unbound" }]);
    mocks.claim.mockResolvedValue(null);
    expect(await runHumanInterviewReminders(job, () => now)).toMatchObject({ unbound: 1 });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("keeps retrying a recipient who binds TG while the current job is running", async () => {
    const unbound = { ...recipient, chatId: null, key: "user:unbound" };
    mocks.recipients
      .mockResolvedValueOnce([unbound])
      .mockResolvedValueOnce([unbound])
      .mockResolvedValue([recipient]);
    mocks.claim.mockResolvedValue(null);
    expect(await runHumanInterviewReminders(job, () => now)).toMatchObject({ retry: true });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not query or send when Telegram is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(runHumanInterviewReminders(job, () => now)).rejects.toThrow(
      "Telegram is not configured",
    );
    expect(mocks.due).not.toHaveBeenCalled();
  });
});

describe("reminder content and recipient identity", () => {
  it("deduplicates overlapping recruiter/ODC/interviewer roles by chat ID", () => {
    const merged = mergeReminderRecipients([
      recipient,
      { ...recipient, roles: ["分配 ODC"] },
      { ...recipient, interviewer: { role: "host", userId: "host" }, roles: ["面试官"] },
    ]);
    expect(merged).toEqual([
      {
        ...recipient,
        interviewer: { role: "host", userId: "host" },
        roles: ["招聘人员", "分配 ODC", "面试官"],
      },
    ]);
  });
  it("includes the exact Beijing time and no interviewer credential for recruiters", () => {
    const text = JSON.stringify(buildHumanInterviewReminderMessage([reminder], recipient));
    expect(text).toContain("2026年10月9日 10:00（北京时间）");
    expect(text).toContain("测试候选人");
    expect(text).toContain("工程师");
    expect(text).toContain("/w/test/studio/resumes/candidate");
    expect(text).not.toContain("/human-interview/interviewer/");
  });
  it.each([false, true])(
    "issues only the recipient's own interviewer identity (external=%s)",
    (external) => {
      const card = buildHumanInterviewReminderMessage([reminder], {
        ...recipient,
        interviewer: { external, role: "interviewer", userId: "interviewer-2" },
        roles: ["面试官"],
      });
      const match = JSON.stringify(card).match(
        /https:\/\/example.test\/human-interview\/interviewer\/([^" ]+)/u,
      );
      expect(match).not.toBeNull();
      expect(verifyInterviewerInviteToken(decodeURIComponent(match?.[1] ?? ""))).toMatchObject({
        external,
        meetingId: "meeting",
        role: "interviewer",
        userId: "interviewer-2",
      });
    },
  );
});
