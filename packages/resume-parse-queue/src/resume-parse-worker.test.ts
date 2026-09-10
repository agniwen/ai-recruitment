import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock("bullmq", () => ({
  Queue: vi.fn(),
  Worker: class {
    constructor(...args: unknown[]) {
      mocks.worker(...args);
    }
    on() {
      return this;
    }
  },
}));
const { createResumeParseWorker } = await import("./resume-parse");

describe("resume worker retry context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });
  it.each([
    [0, 2, true],
    [1, 2, false],
    [0, 1, false],
  ])("passes remaining attempts (%i/%i)", async (attemptsMade, attempts, hasAttemptsRemaining) => {
    const processJob = vi.fn();
    createResumeParseWorker(processJob);
    const payload = { batchId: "b", itemId: "i", organizationId: "o", userId: "u" };
    await mocks.worker.mock.calls[0]?.[1]({ attemptsMade, data: payload, opts: { attempts } });
    expect(processJob).toHaveBeenCalledWith(payload, { hasAttemptsRemaining });
  });
});
