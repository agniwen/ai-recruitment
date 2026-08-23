import { describe, expect, it } from "vitest";
import {
  extractTelegramUsername,
  normalizeTelegramUsername,
  resolveTelegramRecipientId,
} from "./identity";

describe("extractTelegramUsername", () => {
  it.each([
    ["吕芮龙@qiusen0323", "qiusen0323"],
    ["@Qiusen0323", "qiusen0323"],
    ["qiusen0323", "qiusen0323"],
  ])("extracts the Telegram username from %s", (value, expected) => {
    expect(extractTelegramUsername(value)).toBe(expected);
  });

  it("rejects names and malformed Telegram usernames", () => {
    expect(extractTelegramUsername("吕芮龙")).toBeNull();
    expect(extractTelegramUsername("@abc")).toBeNull();
    expect(extractTelegramUsername("qiusen0323 extra")).toBeNull();
  });
});

describe("normalizeTelegramUsername", () => {
  it("normalizes profile handles and Telegram usernames to the same key", () => {
    expect(normalizeTelegramUsername("  @Recruiter_01 ")).toBe("recruiter_01");
    expect(normalizeTelegramUsername("Recruiter_01")).toBe("recruiter_01");
  });

  it("rejects blank values and numeric chat ids as usernames", () => {
    expect(normalizeTelegramUsername("   ")).toBeNull();
    expect(normalizeTelegramUsername("123456789")).toBeNull();
  });
});

describe("resolveTelegramRecipientId", () => {
  it("uses a direct numeric TG id when the profile already contains one", () => {
    expect(
      resolveTelegramRecipientId({
        boundUsername: null,
        chatId: null,
        profileTelegram: "123456789",
      }),
    ).toBe("123456789");
    expect(
      resolveTelegramRecipientId({
        boundUsername: null,
        chatId: null,
        profileTelegram: "-100123456789",
      }),
    ).toBeNull();
  });

  it("uses a bound chat id only while the bound username matches the profile", () => {
    expect(
      resolveTelegramRecipientId({
        boundUsername: "recruiter_01",
        chatId: "123456789",
        profileTelegram: "@Recruiter_01",
      }),
    ).toBe("123456789");
    expect(
      resolveTelegramRecipientId({
        boundUsername: "old_name",
        chatId: "123456789",
        profileTelegram: "@new_name",
      }),
    ).toBeNull();
  });
});
