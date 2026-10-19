import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { retryUploadItem } from "./retry-upload-item";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  retry: vi.fn(),
  rows: [] as unknown[],
  where: vi.fn(),
}));
vi.mock("./retry", () => ({ retryFailedResumeParse: mocks.retry }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidate,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (condition: SQL) => {
            mocks.where(condition);
            return { limit: () => mocks.rows };
          },
        }),
      }),
    }),
  },
}));

describe("retry upload item", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [
      {
        organizationId: "org",
        poolItemId: "private-copy",
        resumeRecordId: "candidate",
        target: "resume_library",
      },
    ];
    mocks.retry.mockResolvedValue({ status: "queued" });
  });
  it("scopes uploader retries in SQL and retries the candidate rather than its private pool copy", async () => {
    expect(
      await retryUploadItem({
        itemId: "item",
        organizationId: "org",
        requestedBy: "user",
        userId: "user",
      }),
    ).toEqual({ status: "queued" });
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([
      "item",
      "org",
      "user",
    ]);
    expect(mocks.retry).toHaveBeenCalledWith({
      allowExhaustedRetries: true,
      itemId: "item",
      organizationId: "org",
      requestedBy: "user",
      resumeRecordId: "candidate",
    });
    expect(mocks.invalidate).toHaveBeenCalledWith("org");
  });
  it("retries a pool upload through its pool target", async () => {
    mocks.rows = [
      { organizationId: "org", poolItemId: "pool", resumeRecordId: null, target: "resume_pool" },
    ];
    await retryUploadItem({ itemId: "item", requestedBy: "admin" });
    expect(mocks.retry).toHaveBeenCalledWith(
      expect.objectContaining({ allowExhaustedRetries: true, itemId: "item", poolItemId: "pool" }),
    );
  });
  it("does not retry records outside the query scope", async () => {
    mocks.rows = [];
    expect(
      await retryUploadItem({
        itemId: "item",
        organizationId: "other-org",
        requestedBy: "other-user",
        userId: "other-user",
      }),
    ).toEqual({ status: "not_found" });
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
