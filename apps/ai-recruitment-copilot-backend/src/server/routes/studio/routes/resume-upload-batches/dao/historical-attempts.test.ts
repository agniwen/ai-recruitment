/* oxlint-disable promise/prefer-await-to-callbacks -- the mock implements Drizzle transaction callbacks. */
import { describe, expect, it, vi } from "vitest";
import { finishHistoricalImportAttempt } from "./historical-attempts";

const mocks = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[] }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    transaction: (callback: (tx: unknown) => unknown) =>
      callback({
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            mocks.patches.push(patch);
            return { where: () => ({ returning: () => [{ failureCount: 1 }] }) };
          },
        }),
      }),
  },
}));

describe("failed parse attempt persistence", () => {
  it("stores the full response separately from the bounded error summary", async () => {
    const text = `{"name":${"候选人".repeat(1000)}`;
    const error = new Error("结构化提取失败", {
      cause: Object.assign(new Error("invalid schema"), {
        modelResponse: { objectJson: '{"age":"unknown"}', text },
      }),
    });
    await finishHistoricalImportAttempt({
      attemptId: "attempt-1",
      error,
      itemId: "item-1",
      status: "failed",
    });
    expect(mocks.patches[0]).toMatchObject({
      errorDetails: { chain: [{}, { modelResponse: { objectJson: '{"age":"unknown"}', text } }] },
      errorMessage: "结构化提取失败",
      status: "failed",
    });
  });
});
