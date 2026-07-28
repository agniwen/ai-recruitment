import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() for hoisted DB replacement.
import { submitResumeEvaluation, updateResumeEvaluationStatus } from "./evaluation";

function createTransaction(currentStatus: "fail" | "pass" | null) {
  const auditRows: Record<string, unknown>[] = [];
  const updatePatches: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        auditRows.push(value);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: () => Promise.resolve([{ resumeEvaluationStatus: currentStatus }]),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { auditRows, tx, updatePatches };
}

function useTransaction(tx: unknown) {
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Drizzle transactions use a callback API.
  mocks.transaction.mockImplementation((callback) => callback(tx));
}

describe("submitResumeEvaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records every failed evaluation even when the current result is already fail", async () => {
    const { auditRows, tx, updatePatches } = createTransaction("fail");
    useTransaction(tx);

    const result = await submitResumeEvaluation({
      id: "resume-1",
      operatorId: "reviewer-2",
      organizationId: "org-1",
      reason: "仍不符合要求",
      status: "fail",
    });

    expect(result).toEqual({ currentStatus: "fail", status: "updated" });
    expect(updatePatches).toEqual([expect.objectContaining({ resumeEvaluationStatus: "fail" })]);
    expect(auditRows).toContainEqual(
      expect.objectContaining({
        action: "resume_evaluation_updated",
        detail: expect.objectContaining({
          fromStatus: "fail",
          reason: "仍不符合要求",
          toStatus: "fail",
        }),
        operatorId: "reviewer-2",
      }),
    );
  });

  it("allows a later reviewer to replace fail with pass and records the transition", async () => {
    const { auditRows, tx, updatePatches } = createTransaction("fail");
    useTransaction(tx);

    const result = await submitResumeEvaluation({
      availableTimeSlots: [
        { endAt: "2026-07-29T11:00:00.000Z", startAt: "2026-07-29T10:00:00.000Z" },
      ],
      id: "resume-1",
      operatorId: "reviewer-3",
      organizationId: "org-1",
      reason: "综合评估通过",
      status: "pass",
    });

    expect(result).toEqual({ currentStatus: "pass", status: "updated" });
    expect(updatePatches).toEqual([expect.objectContaining({ resumeEvaluationStatus: "pass" })]);
    expect(auditRows).toContainEqual(
      expect.objectContaining({
        action: "resume_evaluation_updated",
        detail: expect.objectContaining({ fromStatus: "fail", toStatus: "pass" }),
        operatorId: "reviewer-3",
      }),
    );
  });

  it("treats pass as terminal and writes neither status nor audit changes", async () => {
    const { auditRows, tx, updatePatches } = createTransaction("pass");
    useTransaction(tx);

    const result = await submitResumeEvaluation({
      id: "resume-1",
      operatorId: "reviewer-4",
      organizationId: "org-1",
      reason: "尝试覆盖已通过结果",
      status: "fail",
    });

    expect(result).toEqual({ currentStatus: "pass", status: "already_passed" });
    expect(updatePatches).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it("also prevents admin status updates from reopening a passed evaluation", async () => {
    const { auditRows, tx, updatePatches } = createTransaction("pass");
    useTransaction(tx);

    const result = await updateResumeEvaluationStatus({
      id: "resume-1",
      operatorId: "admin-1",
      organizationId: "org-1",
      status: "fail",
    });

    expect(result).toEqual({ currentStatus: "pass", status: "already_passed" });
    expect(updatePatches).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it("rejects repeated direct pass submissions after pass becomes terminal", async () => {
    const { auditRows, tx, updatePatches } = createTransaction("pass");
    useTransaction(tx);

    const result = await updateResumeEvaluationStatus({
      id: "resume-1",
      operatorId: "admin-2",
      organizationId: "org-1",
      status: "pass",
    });

    expect(result).toEqual({ currentStatus: "pass", status: "already_passed" });
    expect(updatePatches).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });
});
