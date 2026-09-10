/* oxlint-disable promise/prefer-await-to-callbacks -- implements the Drizzle transaction test double. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimFailedResumeParseRetry } from "./retry";
const mocks = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[], status: "failed" }));
vi.mock("./batches", () => ({ reconcileBatchProgress: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    transaction: (callback: (tx: unknown) => unknown) => {
      const query = {
        for: () => [
          {
            batch: {
              createdBy: "user-1",
              failedCount: 2,
              id: "batch-1",
              organizationId: "org-1",
              processedCount: 2,
              status: "completed",
            },
            item: {
              attemptCount: 4,
              errorMessage: "invalid output",
              id: "item-1",
              status: mocks.status,
            },
          },
        ],
        from: () => query,
        innerJoin: () => query,
        limit: () => query,
        orderBy: () => query,
        where: () => query,
      };
      return callback({
        select: () => query,
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            mocks.patches.push(patch);
            return { where: () => ({ returning: () => [{ id: "pool-1" }] }) };
          },
        }),
      });
    },
  },
}));
const input = { organizationId: "org-1", poolItemId: "pool-1", requestedBy: "user-1" };
beforeEach(() => {
  mocks.status = "failed";
  mocks.patches.length = 0;
});
describe("bulk retry claims", () => {
  it("keeps the existing retry limit for ordinary single retries", async () => {
    expect(await claimFailedResumeParseRetry(input)).toEqual({ status: "retry_exhausted" });
    expect(mocks.patches).toEqual([]);
  });
  it("allows an exhausted failed parse to be queued without resetting its attempt history", async () => {
    expect(
      await claimFailedResumeParseRetry({ ...input, allowExhaustedRetries: true }),
    ).toMatchObject({ job: { itemId: "item-1" }, status: "claimed" });
    expect(mocks.patches).toContainEqual(expect.objectContaining({ resumeParseStatus: "queued" }));
    expect(mocks.patches).toContainEqual(expect.objectContaining({ status: "pending" }));
    expect(mocks.patches.every((patch) => !("attemptCount" in patch))).toBe(true);
  });
  it("skips already pending records even for bulk retries", async () => {
    mocks.status = "pending";
    expect(await claimFailedResumeParseRetry({ ...input, allowExhaustedRetries: true })).toEqual({
      status: "not_failed",
    });
    expect(mocks.patches).toEqual([]);
  });
});
