import { afterEach, describe, expect, it, vi } from "vitest";
import { postTelegramOfferRecruiterPrompt } from "./offer-recruiter-prompt";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Telegram recruiter private contact reply prompt", () => {
  it("opens reply mode in the intended private chat", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-test-token");
    const request = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        result: { chat: { id: 12_345, type: "private" }, message_id: 90 },
      }),
    );
    vi.stubGlobal("fetch", request);
    expect(
      await postTelegramOfferRecruiterPrompt({ id: "telegram:12345" }, "补充候选人甲私人TG"),
    ).toBe("12345:90");
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.chat_id).toBe("12345");
    expect(body.reply_markup.force_reply).toBe(true);
    expect(body.text).toContain("候选人甲");
  });
  it("does not accept a response for another chat or expose transport credentials", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          result: { chat: { id: 67_890, type: "private" }, message_id: 90 },
        }),
      ),
    );
    await expect(
      postTelegramOfferRecruiterPrompt({ id: "telegram:12345" }, "补充"),
    ).rejects.toThrow("发送候选人 TG 提示失败");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new Error("https://api.telegram.org/botprivate-test-token/sendMessage")),
    );
    await expect(
      postTelegramOfferRecruiterPrompt({ id: "telegram:12345" }, "补充"),
    ).rejects.toThrow("发送候选人 TG 提示失败");
  });
});
