import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOfferSscNotifications } from "./offer-ssc-notifications";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  dispatch: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
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
});
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.useRealTimers();
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
});
