import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTelegramBot, shutdownTelegramBot } from "./bot";

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  direct: vi.fn(),
  followed: vi.fn(),
  preboarding: vi.fn(),
  recruiter: vi.fn(),
  screenshot: vi.fn(),
}));
vi.mock("../dao", () => ({
  bindTelegramUser: mocks.bind,
  isTelegramNotificationFollower: mocks.followed,
}));
vi.mock("@chat-adapter/state-pg", () => ({ createPostgresState: vi.fn() }));
vi.mock("./offer-telegram-adapter", () => ({ createOfferTelegramAdapter: vi.fn() }));
vi.mock("./offer-ssc", () => ({
  handleTelegramOfferPreboardingMessage: mocks.preboarding,
  handleTelegramOfferScreenshot: mocks.screenshot,
}));
vi.mock("./offer-recruiter-contact", () => ({
  handleTelegramOfferRecruiterMessage: mocks.recruiter,
}));
vi.mock("chat", () => ({
  Chat: class {
    onSlashCommand = vi.fn();
    onAction = vi.fn();
    onDirectMessage = mocks.direct;
    shutdown = vi.fn();
  },
}));

const followedReply =
  "你已关注机器人，无需重复发送 /start。当前消息未匹配到有效操作，请点击对应 Offer 的最新卡片，再回复机器人最新提示。";
const unavailableReply = "暂时无法识别本次操作，请从对应 Offer 的最新卡片重试。";
const defaultRaw = {
  chat: { id: 12_345, type: "private" },
  from: { id: 12_345, username: "test_actor" },
};
const invalidPrivateMessages: [unknown, string][] = [
  [{ chat: { id: 12_345, type: "group" }, from: { id: 12_345 } }, "telegram:12345"],
  [{ chat: { id: 12_345, type: "private" }, from: { id: 98_765 } }, "telegram:12345"],
  [{ chat: { id: 12_345, type: "private" }, from: { id: 12_345 } }, "telegram:98765"],
  [{ chat: { id: -12_345, type: "private" }, from: { id: -12_345 } }, "telegram:-12345"],
  [{ chat: { id: "12345", type: "private" }, from: { id: 12_345 } }, "telegram:12345"],
  [undefined, "telegram:12345"],
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
  mocks.screenshot.mockResolvedValue(false);
  mocks.preboarding.mockResolvedValue(false);
  mocks.recruiter.mockResolvedValue(false);
});
afterEach(async () => {
  await shutdownTelegramBot();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function direct(raw: unknown = defaultRaw, threadId = "telegram:12345") {
  getTelegramBot();
  const thread = { id: threadId, post: vi.fn() };
  const message = { raw, text: "unrecognized input" };
  await mocks.direct.mock.calls[0][0](thread, message);
  expect(mocks.bind).not.toHaveBeenCalled();
  return thread.post;
}

describe("unrecognized private bot message guidance", () => {
  it("guides an existing follower to the latest Offer interaction without repeating opt-in", async () => {
    mocks.followed.mockResolvedValue(true);
    const post = await direct();
    expect(mocks.followed).toHaveBeenCalledWith("12345");
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(followedReply);
  });

  it("keeps the start instruction for an account without an opt-in", async () => {
    mocks.followed.mockResolvedValue(false);
    const post = await direct();
    expect(post).toHaveBeenCalledWith("发送 /start 即可关注并接收通知。");
  });

  it("recognizes a subscribed private account even without a public username", async () => {
    mocks.followed.mockResolvedValue(true);
    const post = await direct({
      chat: { id: 12_345, type: "private" },
      from: { id: 12_345 },
    });
    expect(mocks.followed).toHaveBeenCalledWith("12345");
    expect(post).toHaveBeenCalledWith(followedReply);
  });

  it("does not turn a failed subscription lookup into an instruction to opt in again", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.followed.mockRejectedValue(new Error("private database details"));
    const post = await direct();
    expect(post).toHaveBeenCalledWith(unavailableReply);
    expect(post).not.toHaveBeenCalledWith(expect.stringContaining("/start"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("private database details");
  });

  it.each(invalidPrivateMessages)(
    "does not look up subscription state for a mismatched private identity",
    async (raw, threadId) => {
      const post = await direct(raw ?? null, threadId);
      expect(mocks.followed).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith(unavailableReply);
    },
  );

  it.each(["screenshot", "preboarding", "recruiter"] as const)(
    "preserves the existing %s handler without a fallback lookup or reply",
    async (handler) => {
      mocks[handler].mockResolvedValue(true);
      const post = await direct();
      expect(mocks.followed).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      if (handler === "screenshot") {
        expect(mocks.preboarding).not.toHaveBeenCalled();
        expect(mocks.recruiter).not.toHaveBeenCalled();
      }
      if (handler === "preboarding") {
        expect(mocks.recruiter).not.toHaveBeenCalled();
      }
    },
  );
});
