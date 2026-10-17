import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTelegramOfferScreenshot } from "./offer-ssc-screenshot";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

const reference = {
  fileId: "telegram-file",
  filename: "approval.png",
  mediaType: "image/png" as const,
};
const maxBytes = 10 * 1024 * 1024;

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-bot-token");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Telegram approval screenshot download", () => {
  it("rejects declared oversized files before downloading image bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        result: { file_path: "documents/proof.png", file_size: maxBytes + 1 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(downloadTelegramOfferScreenshot(reference)).rejects.toThrow("10 MB");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts when streamed bytes exceed the limit despite a false content length", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: true, result: { file_path: "documents/proof.png" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(maxBytes));
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
          { headers: { "content-length": "1" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(downloadTelegramOfferScreenshot(reference)).rejects.toThrow("10 MB");
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it("aborts a stalled request after fifteen seconds", async () => {
    vi.useFakeTimers();
    const stalled = Promise.withResolvers<Response>();
    const fetch = vi.fn((_url, options: { signal: AbortSignal }) => {
      options.signal.addEventListener("abort", () => stalled.reject(new Error("request aborted")), {
        once: true,
      });
      return stalled.promise;
    });
    vi.stubGlobal("fetch", fetch);
    const assertion = expect(downloadTelegramOfferScreenshot(reference)).rejects.toThrow(
      "下载失败",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("never exposes credential-bearing download errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error("Failed to fetch https://api.telegram.org/botprivate-bot-token/getFile"),
        ),
    );
    const failure = await downloadTelegramOfferScreenshot(reference).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("private-bot-token");
    expect(String(failure)).not.toContain("api.telegram.org");
  });

  it("rejects traversal paths from file metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, result: { file_path: "../proof.png" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(downloadTelegramOfferScreenshot(reference)).rejects.toThrow("下载失败");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
