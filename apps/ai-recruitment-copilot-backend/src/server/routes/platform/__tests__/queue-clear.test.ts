import { clearPendingParseJobs } from "../queue-clear";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  configured: vi.fn(),
  queue: { getJobs: vi.fn(), isPaused: vi.fn(), pause: vi.fn(), resume: vi.fn() },
}));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  getResumeParseQueue: () => mocks.queue,
  isResumeParseQueueConfigured: mocks.configured,
}));
vi.mock("../../studio/routes/resume-upload-batches/dao/cancel-queued", () => ({
  cancelQueuedUploadItems: mocks.cancel,
}));

describe("clearPendingParseJobs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.queue.isPaused.mockResolvedValue(false);
    mocks.queue.getJobs.mockResolvedValue([]);
  });
  it("cancels pending records before removal, excludes active and historical jobs", async () => {
    const remove = vi.fn().mockResolvedValue(null);
    mocks.queue.getJobs.mockResolvedValue([{ data: { itemId: "item-1" }, remove }]);
    expect(await clearPendingParseJobs()).toEqual({ removed: 1 });
    expect(mocks.queue.getJobs).toHaveBeenCalledWith(
      ["waiting", "paused", "delayed", "prioritized", "waiting-children"],
      0,
      -1,
      true,
    );
    expect(mocks.cancel).toHaveBeenCalledWith(["item-1"]);
    expect(mocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0],
    );
    expect(remove).toHaveBeenCalledWith({ removeChildren: false });
    expect(mocks.queue.resume).toHaveBeenCalledOnce();
  });
  it("preserves an already paused queue", async () => {
    mocks.queue.isPaused.mockResolvedValue(true);
    await clearPendingParseJobs();
    expect(mocks.queue.resume).not.toHaveBeenCalled();
  });
  it("resumes on DB failure without deleting jobs", async () => {
    const remove = vi.fn();
    mocks.queue.getJobs.mockResolvedValue([{ data: { itemId: "item-1" }, remove }]);
    mocks.cancel.mockRejectedValue(new Error("DB unavailable"));
    await expect(clearPendingParseJobs()).rejects.toThrow("DB unavailable");
    expect(remove).not.toHaveBeenCalled();
    expect(mocks.queue.resume).toHaveBeenCalledOnce();
  });
  it("rejects an unconfigured queue", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(clearPendingParseJobs()).rejects.toThrow("Redis 未配置");
    expect(mocks.queue.pause).not.toHaveBeenCalled();
  });
});
