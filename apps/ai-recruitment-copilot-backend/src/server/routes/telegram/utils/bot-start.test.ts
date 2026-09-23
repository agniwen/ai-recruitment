import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTelegramBot, shutdownTelegramBot } from "./bot";

const mocks = vi.hoisted(() => ({ bind: vi.fn(), slash: vi.fn() }));
vi.mock("../dao", () => ({ bindTelegramUser: mocks.bind }));
vi.mock("@chat-adapter/state-pg", () => ({ createPostgresState: vi.fn() }));
vi.mock("@chat-adapter/telegram", () => ({ createTelegramAdapter: vi.fn() }));
vi.mock("chat", () => ({
  Chat: class {
    onSlashCommand = mocks.slash;
    onDirectMessage = vi.fn();
    shutdown = vi.fn();
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
});
afterEach(async () => {
  await shutdownTelegramBot();
  vi.unstubAllEnvs();
});

async function start(type = "private") {
  getTelegramBot();
  expect(mocks.slash).toHaveBeenCalledWith("/start", expect.any(Function));
  const post = vi.fn();
  await mocks.slash.mock.calls[0][1]({
    channel: { post },
    raw: { chat: { id: 12_345, type }, from: { username: "JackLil" } },
    text: "@someone_else",
  });
  return post;
}

describe("Telegram /start binding", () => {
  it("binds the actual private-message sender and confirms external binding", async () => {
    mocks.bind.mockResolvedValue({
      kind: "requester_bound",
      memberAmbiguous: false,
      memberName: null,
    });
    const post = await start();
    expect(mocks.bind).toHaveBeenCalledWith({ chatId: "12345", username: "JackLil" });
    expect(post).toHaveBeenCalledWith("需求发起人通知绑定成功，无需登录系统。");
  });
  it("rejects group binding", async () => {
    const post = await start("group");
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("请私聊机器人并发送 /start 完成通知绑定。");
  });
  it("explains unresolved member ambiguity after binding a requester", async () => {
    mocks.bind.mockResolvedValue({
      kind: "requester_bound",
      memberAmbiguous: true,
      memberName: null,
    });
    const post = await start();
    expect(post).toHaveBeenCalledWith(expect.stringContaining("成员信息未绑定"));
  });
  it("confirms both identities", async () => {
    mocks.bind.mockResolvedValue({
      kind: "requester_bound",
      memberAmbiguous: false,
      memberName: "李杰",
    });
    const post = await start();
    expect(post).toHaveBeenCalledWith(expect.stringContaining("同时已绑定成员信息：李杰"));
  });
  it("provides instructions for external requesters without a match", async () => {
    mocks.bind.mockResolvedValue({ kind: "not_found" });
    const post = await start();
    expect(post).toHaveBeenCalledWith(expect.stringContaining("外部面试官请联系管理员"));
  });
});
