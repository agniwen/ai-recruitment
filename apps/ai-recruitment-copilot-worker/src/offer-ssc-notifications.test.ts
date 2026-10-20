import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOfferSscNotifications } from "./offer-ssc-notifications";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  dispatch: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
const webhookUrl = "https://ats.example.test/api/telegram/webhook";
let fetchTelegram: ReturnType<typeof vi.fn>;
let registeredUpdates: string[] | undefined;
let registeredWebhookUrl: string;

function webhookInfo(allowedUpdates: string[] | undefined, url = webhookUrl) {
  return Response.json({
    ok: true,
    result: {
      allowed_updates: allowedUpdates,
      has_custom_certificate: false,
      max_connections: 40,
      pending_update_count: 0,
      url,
    },
  });
}

function telegramTransport(url: string | URL | Request, init?: RequestInit) {
  if (String(url).endsWith("/getWebhookInfo")) {
    return Promise.resolve(webhookInfo(registeredUpdates, registeredWebhookUrl));
  }
  if (String(url) === webhookUrl) {
    return Promise.resolve(
      new Response(null, {
        status:
          new Headers(init?.headers).get("X-Telegram-Bot-Api-Secret-Token") === "worker-secret"
            ? 200
            : 401,
      }),
    );
  }
  if (String(url).endsWith("/setWebhook")) {
    registeredUpdates = JSON.parse(String(init?.body)).allowed_updates;
    registeredWebhookUrl = JSON.parse(String(init?.body)).url;
    return Promise.resolve(Response.json({ ok: true, result: true }));
  }
  throw new Error("Unexpected network request in notification test");
}
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot", () => ({
  isTelegramBotConfigured: mocks.configured,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-notification-outbox",
  () => ({
    dispatchOfferSscNotifications: mocks.dispatch,
    listenForOfferSscNotifications: mocks.listen,
  }),
);

let close: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.configured.mockReturnValue(true);
  mocks.dispatch.mockResolvedValue(0);
  mocks.listen.mockResolvedValue({ unlisten: mocks.unlisten });
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "worker-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "worker-secret");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test");
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Vitest requires the value argument to unset an environment variable.
  vi.stubEnv("OFFER_SSC_NOTIFICATION_TEST_CHAT_ID", undefined);
  fetchTelegram = vi.fn(telegramTransport);
  registeredUpdates = ["message", "callback_query"];
  registeredWebhookUrl = webhookUrl;
  vi.stubGlobal("fetch", fetchTelegram);
});
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Offer SSC notification worker", () => {
  it("recovers persisted jobs on startup, committed notifications and periodic recovery", async () => {
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    mocks.listen.mock.calls[0][0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.dispatch).toHaveBeenCalledTimes(3);
    const stop = close;
    close = undefined;
    await stop();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.dispatch).toHaveBeenCalledTimes(3);
  });

  it("retains wakeups during delivery without running another dispatch concurrently", async () => {
    const pending = Promise.withResolvers<number>();
    mocks.dispatch.mockReturnValueOnce(pending.promise);
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    mocks.listen.mock.calls[0][0]();
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    pending.resolve(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it("uses periodic recovery when PostgreSQL notifications are unavailable", async () => {
    mocks.listen.mockRejectedValue(new Error("listener unavailable"));
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it("recovers from a failed database poll on a later recovery tick", async () => {
    mocks.dispatch.mockRejectedValueOnce(new Error("database unavailable"));
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it("waits for an active delivery before shutdown completes", async () => {
    const pending = Promise.withResolvers<number>();
    mocks.dispatch.mockReturnValue(pending.promise);
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    const stop = close;
    close = undefined;
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    pending.resolve(0);
    await stopping;
    expect(stopped).toBe(true);
  });

  it("leaves the outbox untouched when Telegram is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("enables callback queries at its existing production webhook before dispatching Offers", async () => {
    registeredUpdates = ["message", "edited_message"];
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    const registration = fetchTelegram.mock.calls.find(([url]) =>
      String(url).endsWith("/setWebhook"),
    );
    expect(registration).toBeDefined();
    expect(JSON.parse(String(registration?.[1]?.body))).toMatchObject({
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: false,
      max_connections: 40,
      secret_token: "worker-secret",
      url: webhookUrl,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not change another environment's shared bot webhook or consume its local outbox", async () => {
    fetchTelegram.mockResolvedValue(webhookInfo(["message"], "https://other.example.test/hook"));
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(fetchTelegram.mock.calls.some(([url]) => String(url).endsWith("/setWebhook"))).toBe(
      false,
    );
  });

  it("does not take back a shared webhook changed while this worker was authenticating", async () => {
    let reads = 0;
    fetchTelegram.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/getWebhookInfo")) {
        reads += 1;
        if (reads === 2) {
          return Promise.resolve(webhookInfo(["message"], "https://relay.example.test/hook"));
        }
      }
      return telegramTransport(url, init);
    });
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(fetchTelegram.mock.calls.some(([url]) => String(url).endsWith("/setWebhook"))).toBe(
      false,
    );
  });

  it.each([{ updates: [] }, { updates: undefined }])(
    "registers a missing webhook preserving its default events: $updates",
    async ({ updates }) => {
      registeredUpdates = updates;
      registeredWebhookUrl = "";
      close = await startOfferSscNotifications();
      await vi.advanceTimersByTimeAsync(0);
      const registration = fetchTelegram.mock.calls.find(([url]) =>
        String(url).endsWith("/setWebhook"),
      );
      expect(registration).toBeDefined();
      expect(JSON.parse(String(registration?.[1]?.body))).toMatchObject({
        allowed_updates: [],
        drop_pending_updates: false,
        secret_token: "worker-secret",
        url: webhookUrl,
      });
      expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a callback that accepts an invalid secret instead of weakening its protection", async () => {
    fetchTelegram.mockImplementation((url: string | URL | Request) =>
      Promise.resolve(
        String(url) === webhookUrl ? new Response(null, { status: 200 }) : webhookInfo(["message"]),
      ),
    );
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(fetchTelegram.mock.calls.some(([url]) => String(url).endsWith("/setWebhook"))).toBe(
      false,
    );
  });

  it("preserves Telegram's unrestricted update filter without narrowing other notifications", async () => {
    registeredUpdates = [];
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    const registration = fetchTelegram.mock.calls.find(([url]) =>
      String(url).endsWith("/setWebhook"),
    );
    expect(registration).toBeDefined();
    expect(JSON.parse(String(registration?.[1]?.body)).allowed_updates).toEqual([]);
  });

  it("reasserts the deployed secret even when button subscriptions already exist", async () => {
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    const registration = fetchTelegram.mock.calls.find(([url]) =>
      String(url).endsWith("/setWebhook"),
    );
    expect(registration).toBeDefined();
    expect(JSON.parse(String(registration?.[1]?.body))).toMatchObject({
      drop_pending_updates: false,
      secret_token: "worker-secret",
      url: webhookUrl,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it("leaves explicitly managed recipient-scoped test callbacks unchanged", async () => {
    vi.stubEnv("OFFER_SSC_NOTIFICATION_TEST_CHAT_ID", "111");
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTelegram).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps Offers pending until its own production callback accepts the configured secret", async () => {
    fetchTelegram.mockImplementation((url: string | URL | Request) =>
      Promise.resolve(
        String(url) === webhookUrl ? new Response(null, { status: 401 }) : webhookInfo(["message"]),
      ),
    );
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(fetchTelegram.mock.calls.some(([url]) => String(url).endsWith("/setWebhook"))).toBe(
      false,
    );
  });

  it("retries webhook initialization after the web service becomes ready", async () => {
    fetchTelegram.mockRejectedValue(new Error("web application is starting"));
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    fetchTelegram.mockImplementation(telegramTransport);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["http://100.96.37.48:3001", "https://user:password@ats.example.test", "not-a-url"])(
    "does not register or dispatch with an invalid public application URL: %s",
    async (url) => {
      vi.stubEnv("NEXT_PUBLIC_BASE_URL", url);
      close = await startOfferSscNotifications();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchTelegram).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it("waits for the public application URL without consuming notification jobs", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTelegram).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("does not replace a webhook that needs a custom certificate", async () => {
    fetchTelegram.mockResolvedValue(
      Response.json({
        ok: true,
        result: { allowed_updates: ["message"], has_custom_certificate: true, url: webhookUrl },
      }),
    );
    close = await startOfferSscNotifications();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(fetchTelegram.mock.calls.some(([url]) => String(url).endsWith("/setWebhook"))).toBe(
      false,
    );
  });

  it("does not expose the bot token from failed webhook transport errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchTelegram.mockRejectedValue(
      new Error("https://api.telegram.org/botworker-token/getWebhookInfo"),
    );
    try {
      close = await startOfferSscNotifications();
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("worker-token");
    } finally {
      warn.mockRestore();
    }
  });
});
