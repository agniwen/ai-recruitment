import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postTelegramDirectMessage, shutdownTelegramBot } from "./bot";

const mocks = vi.hoisted(() => ({
  appendToList: vi.fn(),
  connect: vi.fn(),
  connected: false,
  disconnect: vi.fn(),
  initializeAdapter: vi.fn(),
  openDM: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock("../dao", () => ({ bindTelegramUser: vi.fn() }));
vi.mock("@chat-adapter/state-pg", () => ({
  createPostgresState: () => ({
    appendToList: mocks.appendToList,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
  }),
}));
vi.mock("@chat-adapter/telegram", () => ({
  createTelegramAdapter: () => ({
    channelIdFromThreadId: (threadId: string) => threadId,
    initialize: mocks.initializeAdapter,
    name: "telegram",
    openDM: mocks.openDM,
    persistThreadHistory: true,
    postMessage: mocks.postMessage,
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
  mocks.connected = false;
  mocks.connect.mockImplementation(() => {
    mocks.connected = true;
    return Promise.resolve();
  });
  mocks.disconnect.mockImplementation(() => {
    mocks.connected = false;
    return Promise.resolve();
  });
  mocks.appendToList.mockImplementation(() => {
    if (!mocks.connected) {
      return Promise.reject(
        new Error("PostgresStateAdapter is not connected. Call connect() first."),
      );
    }
    return Promise.resolve();
  });
  mocks.openDM.mockImplementation((chatId: string) => Promise.resolve(`telegram:${chatId}`));
  mocks.postMessage.mockResolvedValue({ id: "message-1" });
});

afterEach(async () => {
  await shutdownTelegramBot();
  vi.unstubAllEnvs();
});

describe("Telegram proactive notifications with the real Chat SDK lifecycle", () => {
  it("connects state before sending without an earlier webhook", async () => {
    await postTelegramDirectMessage("10001", "候选人状态更新");

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.initializeAdapter).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledBefore(mocks.postMessage);
    expect(mocks.postMessage).toHaveBeenCalledWith("telegram:10001", "候选人状态更新");
    expect(mocks.appendToList).toHaveBeenCalledOnce();
  });

  it("shares initialization across concurrent ODC notifications", async () => {
    await Promise.all([
      postTelegramDirectMessage("10001", "通知 A"),
      postTelegramDirectMessage("10002", "通知 B"),
    ]);

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.initializeAdapter).toHaveBeenCalledOnce();
    expect(mocks.postMessage).toHaveBeenCalledTimes(2);
    expect(mocks.appendToList).toHaveBeenCalledTimes(2);
  });

  it("does not send when state initialization fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(postTelegramDirectMessage("10001", "通知")).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.openDM).not.toHaveBeenCalled();
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("initializes again after shutdown", async () => {
    await postTelegramDirectMessage("10001", "第一次通知");
    await shutdownTelegramBot();
    await postTelegramDirectMessage("10001", "第二次通知");

    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.postMessage).toHaveBeenCalledTimes(2);
  });
});
