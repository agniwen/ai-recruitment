import { beforeEach, expect, it, vi } from "vitest";
import { rejectCandidateAiReview } from "./dao";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), invalidate: vi.fn(), transaction: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidate,
}));
vi.mock("../../../interviews/dao/ai-review-approval", () => ({
  canApproveCandidateAiReview: mocks.authorize,
}));

const input = {
  approvalNote: "不匹配",
  candidateId: "candidate-a",
  operatorId: "approver-a",
  organizationId: "org-a",
};
function setup(
  record:
    | { pipelineStage: string; resumeReviewStatus: string; aiReviewApprovalStatus: string }
    | undefined,
) {
  const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(null) }));
  const values = vi.fn().mockResolvedValue(null);
  const tx = {
    insert: () => ({ values }),
    select: () => ({
      from: () => ({
        where: () => ({ for: () => ({ limit: () => Promise.resolve(record ? [record] : []) }) }),
      }),
    }),
    update: () => ({ set }),
  };
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Execute the transaction callback against the test executor.
  mocks.transaction.mockImplementation(async (callback) => await callback(tx));
  return { set, values };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue(true);
});

it("persists only the approval substatus and audits the unchanged stage", async () => {
  const { set, values } = setup({
    aiReviewApprovalStatus: "pending",
    pipelineStage: "ai_review",
    resumeReviewStatus: "ready",
  });
  expect(await rejectCandidateAiReview(input)).toEqual({ kind: "ok" });
  expect(set).toHaveBeenCalledWith({
    aiReviewApprovalStatus: "rejected",
    updatedAt: expect.any(Date),
  });
  expect(values).toHaveBeenCalledWith(
    expect.objectContaining({
      detail: expect.objectContaining({
        approvalDecision: "rejected",
        fromStage: "ai_review",
        reason: "不匹配",
        toOutcome: "in_pipeline",
        toStage: "ai_review",
      }),
    }),
  );
  expect(mocks.invalidate).toHaveBeenCalledWith("org-a");
});
it.each([
  [undefined, "not_found"],
  [
    { aiReviewApprovalStatus: "approved", pipelineStage: "screening", resumeReviewStatus: "ready" },
    "not_found",
  ],
  [
    {
      aiReviewApprovalStatus: "pending",
      pipelineStage: "ai_review",
      resumeReviewStatus: "processing",
    },
    "invalid",
  ],
] as const)("does not reject stale or unready candidates", async (record, kind) => {
  const { set, values } = setup(record);
  const result = await rejectCandidateAiReview(input);
  expect(result.kind).toBe(kind);
  expect(set).not.toHaveBeenCalled();
  expect(values).not.toHaveBeenCalled();
});
it("does not duplicate a rejection audit on retry", async () => {
  const { set, values } = setup({
    aiReviewApprovalStatus: "rejected",
    pipelineStage: "ai_review",
    resumeReviewStatus: "ready",
  });
  expect(await rejectCandidateAiReview(input)).toEqual({ kind: "ok" });
  expect(set).not.toHaveBeenCalled();
  expect(values).not.toHaveBeenCalled();
});
it("checks authority before writing", async () => {
  const { set } = setup(undefined);
  mocks.authorize.mockResolvedValue(false);
  expect(await rejectCandidateAiReview(input)).toEqual({ kind: "forbidden" });
  expect(set).not.toHaveBeenCalled();
});
