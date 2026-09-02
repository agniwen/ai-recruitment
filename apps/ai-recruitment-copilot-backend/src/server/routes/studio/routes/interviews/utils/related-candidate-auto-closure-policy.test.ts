import { describe, expect, it } from "vitest";
import {
  buildAutomaticCandidateClosure,
  collectSemanticDuplicateCandidates,
  isDirectUploadCandidate,
} from "./related-candidate-auto-closure-policy";

describe("related candidate automatic closure policy", () => {
  it("recognizes current and legacy direct uploads without treating pool imports as direct", () => {
    expect(isDirectUploadCandidate({ poolItemId: null, sourceType: "direct_upload" })).toBe(true);
    expect(isDirectUploadCandidate({ poolItemId: null, sourceType: null })).toBe(true);
    expect(isDirectUploadCandidate({ poolItemId: "pool-1", sourceType: "public_pool" })).toBe(
      false,
    );
    expect(isDirectUploadCandidate({ poolItemId: null, sourceType: "chat_import" })).toBe(false);
  });

  it("collects >=90 semantic duplicates in either stored direction and keeps the highest score", () => {
    expect(
      collectSemanticDuplicateCandidates("winner", [
        { matchedSourceId: "candidate-a", score: 93, sourceId: "winner" },
        { matchedSourceId: "winner", score: 91, sourceId: "candidate-b" },
        { matchedSourceId: "candidate-a", score: 95, sourceId: "winner" },
        { matchedSourceId: "candidate-c", score: 89, sourceId: "winner" },
        { matchedSourceId: "winner", score: 100, sourceId: "winner" },
      ]),
    ).toEqual([
      { candidateId: "candidate-a", similarityScore: 95 },
      { candidateId: "candidate-b", similarityScore: 91 },
    ]);
  });

  it("builds an archived transition and audit detail naming the hired pool-derived candidate", () => {
    const now = new Date("2026-08-31T08:00:00.000Z");

    const result = buildAutomaticCandidateClosure({
      candidate: {
        closedMeta: null,
        id: "candidate-other",
        name: "候选人乙",
        outcome: "in_pipeline",
        pipelineStage: "human_interview",
      },
      hiredCandidate: { id: "candidate-winner", name: "候选人甲" },
      match: { kind: "resume_pool_source" },
      now,
    });

    expect(result.auditDetail).toMatchObject({
      automaticClosure: true,
      fromOutcome: "in_pipeline",
      fromStage: "human_interview",
      matchKind: "resume_pool_source",
      reason: "同一简历池记录派生的候选人「候选人甲」已录用，系统自动结束流程。",
      similarityScore: null,
      toOutcome: "archived",
      toStage: "closed",
      triggerCandidateId: "candidate-winner",
      triggerCandidateName: "候选人甲",
    });
    expect(result.patch).toMatchObject({
      closedAt: now,
      closedMeta: {
        category: "other",
        internalNotes: "同一简历池记录派生的候选人「候选人甲」已录用，系统自动结束流程。",
        previousStage: "human_interview",
      },
      closedReason: "已入职其他岗位",
      outcome: "archived",
      pipelineStage: "closed",
      updatedAt: now,
    });
  });

  it("records semantic similarity in automatic closure copy and audit detail", () => {
    const result = buildAutomaticCandidateClosure({
      candidate: {
        closedMeta: null,
        id: "candidate-other",
        name: "候选人乙",
        outcome: "in_pipeline",
        pipelineStage: "screening",
      },
      hiredCandidate: { id: "candidate-winner", name: "候选人甲" },
      match: { kind: "semantic_similarity", similarityScore: 94 },
      now: new Date("2026-08-31T08:00:00.000Z"),
    });

    expect(result.auditDetail).toMatchObject({
      automaticClosure: true,
      matchKind: "semantic_similarity",
      similarityScore: 94,
      triggerCandidateId: "candidate-winner",
    });
    expect(result.patch.closedReason).toBe("已入职其他岗位");
  });
});
