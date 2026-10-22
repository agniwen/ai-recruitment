import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTelegramBot, shutdownTelegramBot } from "./bot";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  direct: vi.fn(),
  recruiterAction: vi.fn(),
  recruiterMessage: vi.fn(),
  screenshot: vi.fn(),
}));
vi.mock("../dao", () => ({ bindTelegramUser: vi.fn() }));
vi.mock("@chat-adapter/state-pg", () => ({ createPostgresState: vi.fn() }));
vi.mock("./offer-telegram-adapter", () => ({ createOfferTelegramAdapter: vi.fn() }));
vi.mock("./offer-recruiter-contact", () => ({
  handleTelegramOfferRecruiterAction: mocks.recruiterAction,
  handleTelegramOfferRecruiterMessage: mocks.recruiterMessage,
}));
vi.mock("./offer-ssc", () => ({ handleTelegramOfferScreenshot: mocks.screenshot }));
vi.mock("chat", () => ({
  Chat: class {
    onSlashCommand = vi.fn();
    onAction = mocks.action;
    onDirectMessage = mocks.direct;
    shutdown = vi.fn();
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
  mocks.screenshot.mockResolvedValue(false);
  mocks.recruiterMessage.mockResolvedValue(false);
});
afterEach(async () => {
  await shutdownTelegramBot();
  vi.unstubAllEnvs();
});

describe("recruiter contact bot dispatch", () => {
  it("registers recruiter actions separately from the existing SSC controls", async () => {
    getTelegramBot();
    const registration = mocks.action.mock.calls.find(([ids]) => ids.includes("orc"));
    expect(registration?.[0]).toEqual(["orc", "ors"]);
    const event = { actionId: "orc", value: "offer" };
    await registration?.[1](event);
    expect(mocks.recruiterAction).toHaveBeenCalledWith(event);
    expect(mocks.action).toHaveBeenCalledWith(
      ["osr", "osc", "osf", "osu", "osx"],
      expect.any(Function),
    );
  });
  it("handles private contact replies without the unrelated start fallback", async () => {
    mocks.recruiterMessage.mockResolvedValue(true);
    getTelegramBot();
    const thread = { post: vi.fn() };
    const message = { text: "@candidate_a" };
    await mocks.direct.mock.calls[0][0](thread, message);
    expect(mocks.recruiterMessage).toHaveBeenCalledWith(thread, message);
    expect(thread.post).not.toHaveBeenCalled();
  });
  it("preserves the approval screenshot flow", async () => {
    mocks.screenshot.mockResolvedValue(true);
    getTelegramBot();
    const thread = { post: vi.fn() };
    await mocks.direct.mock.calls[0][0](thread, { attachments: [{}] });
    expect(mocks.recruiterMessage).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });
});
