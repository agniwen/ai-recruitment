import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryFailedParseJobs } from "../queue-retry";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), list: vi.fn(), retry: vi.fn() }));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  isResumeParseQueueConfigured: mocks.configured,
}));
vi.mock("../queue-details", () => ({ listResumeParseQueueJobsWithDetailFilters: mocks.list }));
vi.mock("../../studio/routes/resume-upload-batches/utils/retry-upload-item", () => ({
  retryUploadItem: mocks.retry,
}));

function job(id: string, state = "completed", itemStatus = "failed") {
  return { id, resumeDetail: { itemId: id, itemStatus }, state };
}

describe("platform failed parse retry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.retry.mockResolvedValue({ status: "queued" });
  });
  it("snapshots all filtered pages and retries business failures even in completed jobs", async () => {
    mocks.list.mockResolvedValueOnce({
      records: [job("legacy"), job("ready", "completed", "succeeded")],
      totalPages: 2,
    });
    mocks.list.mockResolvedValueOnce({
      records: [job("failed", "failed"), job("active", "active")],
      totalPages: 2,
    });
    mocks.retry.mockImplementation(() => {
      expect(mocks.list).toHaveBeenCalledTimes(2);
      return Promise.resolve({ status: "queued" });
    });
    expect(
      await retryFailedParseJobs({
        filters: { parseStatus: "failed", state: "all" },
        requestedBy: "admin",
      }),
    ).toMatchObject({ failed: 0, queued: 2, skipped: 0, total: 2 });
    expect(mocks.list).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 100,
      parseStatus: "failed",
      state: "all",
    });
    expect(mocks.retry.mock.calls.map(([input]) => input.itemId)).toEqual(["legacy", "failed"]);
  });
  it("deduplicates specified IDs and reports partial failures and concurrent retries", async () => {
    mocks.list
      .mockResolvedValueOnce({ records: [job("one")], totalPages: 1 })
      .mockResolvedValueOnce({ records: [job("two")], totalPages: 1 })
      .mockResolvedValueOnce({ records: [job("three")], totalPages: 1 });
    mocks.retry
      .mockResolvedValueOnce({ status: "queued" })
      .mockResolvedValueOnce({ status: "not_failed" })
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    expect(
      await retryFailedParseJobs({ jobIds: ["one", "one", "two", "three"], requestedBy: "admin" }),
    ).toMatchObject({ failed: 1, queued: 1, skipped: 1, total: 3 });
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });
  it("does not touch task data when Redis is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await retryFailedParseJobs({ jobIds: ["one"], requestedBy: "admin" })).toEqual({
      status: "queue_unavailable",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
