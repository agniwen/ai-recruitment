import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyAiReviewPending } from "./ai-review-notification";

const mocks = vi.hoisted(() => ({
  authorizer: vi.fn(),
  configured: vi.fn(),
  post: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot", () => ({
  isTelegramBotConfigured: mocks.configured,
  postTelegramDirectMessage: mocks.post,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer: mocks.authorizer,
}));

const input = { candidateId: "candidate-1", organizationId: "org-1" };
const candidate = {
  candidateName: "张三",
  jobDescriptionName: "工程师",
  organizationName: "工作区",
  organizationSlug: "work",
  outcome: "in_pipeline",
  pipelineStage: "ai_review",
  resumeReviewStatus: "ready",
};
function recipient(userId: string, chatId: string | null = "123") {
  return {
    role: "custom-role",
    telegram: `@${userId}`,
    telegramBoundUsername: userId,
    telegramChatId: chatId,
    userId,
  };
}
function mockRows(record: Record<string, unknown> | null, members = [recipient("approver")]) {
  const chain = { innerJoin: vi.fn(), leftJoin: vi.fn(), limit: vi.fn(), where: vi.fn() };
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(record ? [record] : []);
  mocks.select.mockReturnValueOnce({ from: () => chain });
  const memberChain = { innerJoin: vi.fn(), where: vi.fn().mockResolvedValue(members) };
  memberChain.innerJoin.mockReturnValue(memberChain);
  mocks.select.mockReturnValueOnce({ from: () => memberChain });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com/");
  mocks.configured.mockReturnValue(true);
  mocks.post.mockResolvedValue(null);
  mocks.authorizer.mockImplementation(
    ({ userId }) =>
      ({ resource, action }: { resource: string; action: string }) =>
        Promise.resolve(
          userId.startsWith("approver") && resource === "aiReview" && action === "approve",
        ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("notifyAiReviewPending", () => {
  it("uses effective approval permissions, skips unbound users and deduplicates Telegram chats", async () => {
    mockRows(candidate, [
      recipient("approver"),
      recipient("viewer", "456"),
      recipient("approver2"),
      recipient("approver3", null),
    ]);
    await notifyAiReviewPending(input);
    expect(mocks.authorizer).toHaveBeenCalledWith({
      memberRole: "custom-role",
      organizationId: "org-1",
      userId: "approver",
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const [chatId, message] = mocks.post.mock.calls[0] ?? [];
    expect(chatId).toBe("123");
    expect(message.title).toBe("简历AI评分推荐-待审批");
    expect(JSON.stringify(message)).toContain("张三");
    expect(JSON.stringify(message)).toContain("https://example.com/resume-review/work/candidate-1");
  });

  it.each([
    null,
    { ...candidate, pipelineStage: "screening" },
    { ...candidate, outcome: "rejected" },
    { ...candidate, resumeReviewStatus: "processing" },
    { ...candidate, resumeReviewStatus: "failed" },
  ])("does not notify for records outside pending scored reviews: %j", async (record) => {
    mockRows(record);
    await notifyAiReviewPending(input);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.authorizer).not.toHaveBeenCalled();
  });

  it("continues delivering to other approvers if one Telegram chat fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRows(candidate, [recipient("approver"), recipient("approver2", "456")]);
    mocks.post.mockRejectedValueOnce(new Error("blocked bot"));
    await expect(notifyAiReviewPending(input)).resolves.toBeUndefined();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });

  it("does not let recipient lookup failures fail scoring", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.select.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    await expect(notifyAiReviewPending(input)).resolves.toBeUndefined();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("skips notifications when Telegram is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    await notifyAiReviewPending(input);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("does not send a notification without a usable detail link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    mockRows(candidate);
    await notifyAiReviewPending(input);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
