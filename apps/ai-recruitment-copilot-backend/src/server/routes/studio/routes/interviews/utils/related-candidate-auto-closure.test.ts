import { describe, expect, it, vi } from "vitest";
import { autoCloseRelatedCandidatesAfterHire } from "./related-candidate-auto-closure";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: vi.fn() },
}));

function queryResult<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, {
    orderBy: vi.fn(() => ({ for: vi.fn(() => Promise.resolve(rows)) })),
  });
}

function createTransaction(selectResults: unknown[][], updateResults: unknown[][] = []) {
  const insertedValues = vi.fn(() => Promise.resolve());
  const setValues: unknown[] = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => queryResult(selectResults.shift() ?? [])),
    })),
  }));
  const update = vi.fn(() => ({
    set: vi.fn((value: unknown) => {
      setValues.push(value);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updateResults.shift() ?? [{ id: "updated" }])),
        })),
      };
    }),
  }));
  return {
    insertedValues,
    setValues,
    tx: {
      insert: vi.fn(() => ({ values: insertedValues })),
      select,
      update,
    },
    update,
  };
}

const candidate = {
  closedMeta: null,
  id: "candidate-b",
  name: "候选人乙",
  outcome: "in_pipeline" as const,
  pipelineStage: "human_interview" as const,
};

describe("autoCloseRelatedCandidatesAfterHire", () => {
  it("archives all in-pipeline records derived from the same pool item and writes system logs", async () => {
    const { insertedValues, setValues, tx } = createTransaction([[candidate]]);
    const now = new Date("2026-08-31T08:00:00.000Z");

    await expect(
      autoCloseRelatedCandidatesAfterHire({
        hiredCandidate: {
          id: "candidate-a",
          name: "候选人甲",
          poolItemId: "pool-a",
          sourceType: "public_pool",
        },
        now,
        operatorId: "operator-a",
        operatorRole: "odc",
        organizationId: "org-a",
        tx: tx as never,
      }),
    ).resolves.toEqual([
      {
        candidateId: "candidate-b",
        candidateName: "候选人乙",
        fromOutcome: "in_pipeline",
        fromStage: "human_interview",
        match: { kind: "resume_pool_source" },
      },
    ]);

    expect(setValues[0]).toMatchObject({
      outcome: "archived",
      pipelineStage: "closed",
    });
    expect(insertedValues).toHaveBeenCalledWith([
      expect.objectContaining({
        action: "candidate_transition",
        detail: expect.objectContaining({
          automaticClosure: true,
          matchKind: "resume_pool_source",
          triggerCandidateId: "candidate-a",
        }),
        interviewRecordId: "candidate-b",
        operatorId: "operator-a",
        operatorRole: "odc",
        source: "system",
      }),
    ]);
  });

  it("uses bidirectional >=90 semantic matches for direct uploads", async () => {
    const { insertedValues, tx, update } = createTransaction([
      [
        { matchedSourceId: "candidate-b", score: 93, sourceId: "candidate-a" },
        { matchedSourceId: "candidate-a", score: 95, sourceId: "candidate-b" },
        { matchedSourceId: "candidate-c", score: 89, sourceId: "candidate-a" },
      ],
      [candidate],
    ]);

    const result = await autoCloseRelatedCandidatesAfterHire({
      hiredCandidate: {
        id: "candidate-a",
        name: "候选人甲",
        poolItemId: null,
        sourceType: "direct_upload",
      },
      now: new Date("2026-08-31T08:00:00.000Z"),
      operatorId: null,
      organizationId: "org-a",
      tx: tx as never,
    });

    expect(result).toEqual([
      expect.objectContaining({
        candidateId: "candidate-b",
        match: { kind: "semantic_similarity", similarityScore: 95 },
      }),
    ]);
    expect(update).toHaveBeenCalledOnce();
    expect(insertedValues).toHaveBeenCalledWith([
      expect.objectContaining({
        detail: expect.objectContaining({
          matchKind: "semantic_similarity",
          similarityScore: 95,
        }),
      }),
    ]);
  });

  it("does nothing for non-pool chat or API imports", async () => {
    const { insertedValues, tx, update } = createTransaction([]);

    await expect(
      autoCloseRelatedCandidatesAfterHire({
        hiredCandidate: {
          id: "candidate-a",
          name: "候选人甲",
          poolItemId: null,
          sourceType: "chat_import",
        },
        now: new Date("2026-08-31T08:00:00.000Z"),
        operatorId: null,
        organizationId: "org-a",
        tx: tx as never,
      }),
    ).resolves.toEqual([]);

    expect(update).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it("does not write an audit log when a candidate stopped being in-pipeline before update", async () => {
    const { insertedValues, tx } = createTransaction([[candidate]], [[]]);

    await expect(
      autoCloseRelatedCandidatesAfterHire({
        hiredCandidate: {
          id: "candidate-a",
          name: "候选人甲",
          poolItemId: "pool-a",
          sourceType: "private_pool",
        },
        now: new Date("2026-08-31T08:00:00.000Z"),
        operatorId: null,
        organizationId: "org-a",
        tx: tx as never,
      }),
    ).resolves.toEqual([]);

    expect(insertedValues).not.toHaveBeenCalled();
  });
});
