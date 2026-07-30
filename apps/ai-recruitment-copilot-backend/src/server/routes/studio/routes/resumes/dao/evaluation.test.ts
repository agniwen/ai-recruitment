import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() for hoisted DB replacement.
import {
  pickLatestPassEvaluationTimeSlots,
  readResumeEvaluationTimeSlots,
  submitResumeEvaluation,
  updateResumeEvaluationStatus,
} from "./evaluation";

describe("readResumeEvaluationTimeSlots", () => {
  it("filters valid start/end pairs from audit detail payloads", () => {
    expect(
      readResumeEvaluationTimeSlots([
        { endAt: "2026-07-02T04:00:00.000Z", startAt: "2026-07-02T02:00:00.000Z" },
        { endAt: "missing-start" },
        "not-an-object",
        null,
      ]),
    ).toEqual([{ endAt: "2026-07-02T04:00:00.000Z", startAt: "2026-07-02T02:00:00.000Z" }]);
    expect(readResumeEvaluationTimeSlots()).toEqual([]);
    expect(readResumeEvaluationTimeSlots(null)).toEqual([]);
  });
});

describe("pickLatestPassEvaluationTimeSlots", () => {
  const olderPassSlots = [
    { endAt: "2026-06-01T04:00:00.000Z", startAt: "2026-06-01T02:00:00.000Z" },
  ];
  const latestPassSlots = [
    { endAt: "2026-07-10T06:00:00.000Z", startAt: "2026-07-10T04:00:00.000Z" },
  ];

  it("uses only the newest pass audit after multi-round evaluations", () => {
    // Newest-first: latest pass → fail → older pass (e.g. after job-change reset).
    expect(
      pickLatestPassEvaluationTimeSlots([
        {
          detail: {
            availableTimeSlots: latestPassSlots,
            toStatus: "pass",
          },
        },
        {
          detail: {
            availableTimeSlots: [],
            toStatus: "fail",
          },
        },
        {
          detail: {
            availableTimeSlots: olderPassSlots,
            toStatus: "pass",
          },
        },
      ]),
    ).toEqual(latestPassSlots);
  });

  it("does not fall back to an older pass when the latest pass has no slots", () => {
    expect(
      pickLatestPassEvaluationTimeSlots([
        {
          detail: {
            availableTimeSlots: [],
            toStatus: "pass",
          },
        },
        {
          detail: {
            availableTimeSlots: olderPassSlots,
            toStatus: "pass",
          },
        },
      ]),
    ).toEqual([]);
  });

  it("skips non-pass audits until the latest pass", () => {
    expect(
      pickLatestPassEvaluationTimeSlots([
        {
          detail: {
            availableTimeSlots: [],
            toStatus: "fail",
          },
        },
        {
          detail: {
            availableTimeSlots: olderPassSlots,
            toStatus: "pass",
          },
        },
      ]),
    ).toEqual(olderPassSlots);
  });
});

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
      departmentName: "研发部",
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
          departmentName: "研发部",
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
      departmentName: "产品部",
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
      departmentName: "市场部",
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
