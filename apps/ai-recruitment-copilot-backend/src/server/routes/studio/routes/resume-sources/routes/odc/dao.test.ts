import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeSourceOdcAssignments } from "./dao";

const mocks = vi.hoisted(() => ({ returning: vi.fn(), rolledBack: vi.fn(), update: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    transaction: async (runTransaction: (tx: unknown) => Promise<unknown>) => {
      try {
        return await runTransaction({
          insert: () => ({
            values: () => ({ onConflictDoNothing: () => ({ returning: mocks.returning }) }),
          }),
          update: mocks.update,
        });
      } catch (error) {
        mocks.rolledBack(error);
        throw error;
      }
    },
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.update.mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
});
describe("batch ODC transaction boundary", () => {
  const input = {
    assignments: [{ memberId: "member-a" }, { memberId: "member-b" }],
    organizationId: "org-a",
    resumeSourceId: "source-a",
  };
  it("commits only when every assignment was inserted", async () => {
    mocks.returning.mockResolvedValue([{ memberId: "member-a" }, { memberId: "member-b" }]);
    await expect(createResumeSourceOdcAssignments(input)).resolves.toBe(true);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.rolledBack).not.toHaveBeenCalled();
  });
  it("throws through the transaction to roll back a partially conflicting batch", async () => {
    mocks.returning.mockResolvedValue([{ memberId: "member-b" }]);
    await expect(createResumeSourceOdcAssignments(input)).resolves.toBe(false);
    expect(mocks.rolledBack).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("propagates unrelated database failures", async () => {
    const error = new Error("connection lost");
    mocks.returning.mockRejectedValue(error);
    await expect(createResumeSourceOdcAssignments(input)).rejects.toBe(error);
    expect(mocks.rolledBack).toHaveBeenCalledWith(error);
  });
});
