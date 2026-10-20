import { afterEach, describe, expect, it, vi } from "vitest";
import { postTelegramOfferScreenshotPrompt } from "./offer-ssc-upload-prompt";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Telegram approval screenshot reply prompt", () => {
  it("opens reply mode for the same private chat and returns the actual prompt id", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-test-token");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        result: { chat: { id: 12_345, type: "private" }, message_id: 42 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await postTelegramOfferScreenshotPrompt({ id: "telegram:12345" }, "请发送审批截图"),
    ).toBe("12345:42");
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.telegram.org/botprivate-test-token/sendMessage");
    expect(JSON.parse(options.body)).toEqual({
      chat_id: "12345",
      reply_markup: { force_reply: true, input_field_placeholder: "发送审批截图（选填）" },
      text: "请发送审批截图",
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { ok: false },
    { ok: true, result: { chat: { id: 67_890, type: "private" }, message_id: 42 } },
    { ok: true, result: { chat: { id: 12_345, type: "group" }, message_id: 42 } },
    { ok: true, result: { chat: { id: 12_345, type: "private" }, message_id: -1 } },
  ])("rejects an unacknowledged prompt or a different chat", async (body) => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(
      postTelegramOfferScreenshotPrompt({ id: "telegram:12345" }, "截图"),
    ).rejects.toThrow("发送审批截图提示失败");
  });

  it("keeps credential-bearing transport errors out of user-facing errors", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-test-token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new Error("https://api.telegram.org/botprivate-test-token/sendMessage")),
    );
    await expect(
      postTelegramOfferScreenshotPrompt({ id: "telegram:12345" }, "截图"),
    ).rejects.toThrow("发送审批截图提示失败");
  });
});
