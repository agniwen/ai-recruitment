import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryFailedResumePoolItems } from "./retry-failed";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), list: vi.fn(), retry: vi.fn() }));
vi.mock("../dao", () => ({ listFailedResumePoolItemIds: mocks.list }));
vi.mock("../../resume-upload-batches/utils/retry", () => ({ retryFailedResumeParse: mocks.retry }));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  isResumeParseQueueConfigured: mocks.configured,
}));
const input = {
  creatorIds: ["user-1"],
  organizationId: "org-1",
  requestedBy: "user-1",
  scope: "private" as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
});

describe("bulk retry failed pool parses", () => {
  it("enqueues every selected failure beyond a UI page, including previously retried records", async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 205 }, (_, i) => ({ id: `pool-${i}` })));
    mocks.retry.mockResolvedValue({ status: "queued" });
    expect(await retryFailedResumePoolItems(input)).toEqual({
      failed: 0,
      queued: 205,
      skipped: 0,
      total: 205,
    });
    expect(mocks.list).toHaveBeenCalledWith(input);
    expect(mocks.retry).toHaveBeenCalledTimes(205);
    expect(mocks.retry).toHaveBeenCalledWith({
      allowExhaustedRetries: true,
      organizationId: "org-1",
      poolItemId: "pool-204",
      requestedBy: "user-1",
    });
  });
  it("continues after enqueue errors and skips records already claimed by another request", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.list.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
    mocks.retry
      .mockResolvedValueOnce({ status: "not_failed" })
      .mockRejectedValueOnce(new Error("redis unavailable"))
      .mockResolvedValueOnce({ status: "queued" });
    expect(await retryFailedResumePoolItems(input)).toEqual({
      failed: 1,
      queued: 1,
      skipped: 1,
      total: 3,
    });
    log.mockRestore();
  });
  it("does nothing when there are no failed resumes", async () => {
    mocks.list.mockResolvedValue([]);
    expect(await retryFailedResumePoolItems(input)).toEqual({
      failed: 0,
      queued: 0,
      skipped: 0,
      total: 0,
    });
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("does not claim records without a configured queue", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(retryFailedResumePoolItems(input)).rejects.toThrow("REDIS_URL");
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
