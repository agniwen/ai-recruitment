import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTelegramNotificationFollower } from "./dao";

const mocks = vi.hoisted(() => ({
  findFollower: vi.fn(),
  insert: vi.fn(),
  provision: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./ssc-telegram-provisioning", () => ({
  provisionSscTelegramFollower: mocks.provision,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    insert: mocks.insert,
    query: { telegramRecipientBinding: { findFirst: mocks.findFollower } },
    transaction: mocks.transaction,
    update: mocks.update,
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("read-only Telegram notification subscription lookup", () => {
  it("recognizes a numeric follower independently of a username or system identity", async () => {
    mocks.findFollower.mockResolvedValue({ chatId: "12345" });
    expect(await isTelegramNotificationFollower("12345")).toBe(true);
    expect(mocks.findFollower).toHaveBeenCalledWith({
      columns: { chatId: true },
      where: { chatId: "12345" },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("returns false only when a successful read finds no opt-in", async () => {
    mocks.findFollower.mockImplementation(() => Promise.resolve());
    expect(await isTelegramNotificationFollower("12345")).toBe(false);
  });

  it("preserves database failures instead of misreporting an unsubscribed account", async () => {
    mocks.findFollower.mockRejectedValue(new Error("database unavailable"));
    await expect(isTelegramNotificationFollower("12345")).rejects.toThrow("database unavailable");
  });

  it.each(["", "@someone", "0", "-12345", "12 345"])(
    "does not query an invalid private numeric chat ID: %s",
    async (chatId) => {
      expect(await isTelegramNotificationFollower(chatId)).toBe(false);
      expect(mocks.findFollower).not.toHaveBeenCalled();
    },
  );
});
