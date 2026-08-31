import { beforeEach, describe, expect, it, vi } from "vitest";
import { transitionCandidateStage } from "./candidate-stage-transition";

// oxlint-disable promise/prefer-await-to-callbacks -- the fake transaction must execute Drizzle's callback.

const mocks = vi.hoisted(() => ({
  autoCloseRelatedCandidatesAfterHire: vi.fn(),
  getReadinessError: vi.fn(),
  invalidateCaches: vi.fn(),
  loadReadiness: vi.fn(),
  notifyCandidateStageChange: vi.fn(),
  refreshDirectUploadDuplicateMatchesBeforeHire: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidateCaches,
}));

vi.mock("./candidate-stage-notification", () => ({
  notifyCandidateStageChange: mocks.notifyCandidateStageChange,
}));

vi.mock("./related-candidate-auto-closure", () => ({
  autoCloseRelatedCandidatesAfterHire: mocks.autoCloseRelatedCandidatesAfterHire,
}));

vi.mock("./direct-upload-dedup-refresh", () => ({
  refreshDirectUploadDuplicateMatchesBeforeHire:
    mocks.refreshDirectUploadDuplicateMatchesBeforeHire,
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds",
  () => ({
    getHumanInterviewOfferReadinessError: mocks.getReadinessError,
    loadHumanInterviewRoundReadiness: mocks.loadReadiness,
  }),
);

function createTransaction(existing: {
  candidateName?: string;
  closedMeta: null;
  jobDescriptionAiInterviewDisabled?: boolean;
  jobDescriptionId: string | null;
  outcome: "archived" | "in_pipeline";
  pipelineStage: "closed" | "human_interview" | "screening";
  resumeSourcePoolItemId?: string | null;
  resumeSourceType?: "direct_upload" | "private_pool" | "public_pool" | null;
}) {
  const insertedValues = vi.fn(async (_value: unknown) => {});
  const updatedWhere = vi.fn(async (_value: unknown) => {});
  const tx = {
    execute: vi.fn(() => Promise.resolve()),
    insert: vi.fn(() => ({ values: insertedValues })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  candidateName: "候选人甲",
                  resumeSourcePoolItemId: null,
                  resumeSourceType: "direct_upload",
                  ...existing,
                },
              ]),
            })),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: updatedWhere })),
    })),
  };
  return { insertedValues, tx, updatedWhere };
}

describe("transitionCandidateStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autoCloseRelatedCandidatesAfterHire.mockResolvedValue([]);
    mocks.notifyCandidateStageChange.mockImplementation(() => Promise.resolve());
    mocks.refreshDirectUploadDuplicateMatchesBeforeHire.mockImplementation(() => Promise.resolve());
  });

  it("authorizes protected target stages before opening the transaction", async () => {
    const authorize = vi.fn().mockResolvedValue(false);

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { pipelineStage: "offer" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(authorize).toHaveBeenCalledWith({ action: "create", resource: "offer" });
    expect(authorize).not.toHaveBeenCalledWith({ action: "update", resource: "interview" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invalidateCaches).not.toHaveBeenCalled();
  });

  it("advances to offer with only offer:create (no interview:update required)", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "human_interview",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));
    mocks.loadReadiness.mockResolvedValue({
      completedRoundsMissingFeedback: 0,
      pendingRounds: 0,
      totalRounds: 1,
    });
    mocks.getReadinessError.mockReturnValue(null);
    const authorize = vi.fn(({ action, resource }) =>
      Promise.resolve(resource === "offer" && action === "create"),
    );

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { pipelineStage: "offer" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "ok" });

    expect(authorize).toHaveBeenCalledWith({ action: "create", resource: "offer" });
    expect(authorize).not.toHaveBeenCalledWith({ action: "update", resource: "interview" });
    expect(updatedWhere).toHaveBeenCalledOnce();
    expect(insertedValues).toHaveBeenCalledOnce();
  });

  it("advances to human interview with only humanInterview:create", async () => {
    const { tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));
    const authorize = vi.fn(({ action, resource }) =>
      Promise.resolve(resource === "humanInterview" && action === "create"),
    );

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { pipelineStage: "human_interview" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "ok" });

    expect(authorize).toHaveBeenCalledWith({ action: "create", resource: "humanInterview" });
    expect(authorize).not.toHaveBeenCalledWith({ action: "update", resource: "interview" });
    expect(updatedWhere).toHaveBeenCalledOnce();
  });

  it("requires interview:update for non-stage-owned transitions", async () => {
    const authorize = vi.fn().mockResolvedValue(false);

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { pipelineStage: "ai_interview" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(authorize).toHaveBeenCalledWith({ action: "update", resource: "interview" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("closes a candidate with only candidateClose:create", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));
    const authorize = vi.fn(({ action, resource }) =>
      Promise.resolve(resource === "candidateClose" && action === "create"),
    );

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { outcome: "rejected", pipelineStage: "closed" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "ok" });

    expect(authorize).toHaveBeenCalledWith({ action: "create", resource: "candidateClose" });
    expect(authorize).not.toHaveBeenCalledWith({ action: "update", resource: "interview" });
    expect(updatedWhere).toHaveBeenCalledOnce();
    expect(insertedValues).toHaveBeenCalledOnce();
  });

  it("rejects a hired close without pre-onboarding TG before opening the transaction", async () => {
    const authorize = vi.fn().mockResolvedValue(true);

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { outcome: "hired", pipelineStage: "closed" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({
      kind: "invalid",
      message: "标记为已到岗时，请填写入职前 TG。",
    });

    expect(authorize).toHaveBeenCalledWith({ action: "create", resource: "candidateClose" });
    expect(mocks.refreshDirectUploadDuplicateMatchesBeforeHire).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("automatically closes related in-pipeline candidates when this candidate is hired", async () => {
    const { insertedValues, tx } = createTransaction({
      candidateName: "候选人甲",
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "human_interview",
      resumeSourcePoolItemId: "pool-a",
      resumeSourceType: "public_pool",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));
    mocks.autoCloseRelatedCandidatesAfterHire.mockResolvedValue([
      {
        candidateId: "candidate-b",
        candidateName: "候选人乙",
        fromOutcome: "in_pipeline",
        fromStage: "screening",
        match: { kind: "resume_pool_source" },
      },
    ]);
    mocks.refreshDirectUploadDuplicateMatchesBeforeHire.mockResolvedValue([
      { candidateId: "candidate-b", similarityScore: 94 },
    ]);

    await expect(
      transitionCandidateStage({
        authorize: vi.fn().mockResolvedValue(true),
        candidateId: "candidate-a",
        input: {
          closedMeta: { hiredDetails: { preOnboardingTelegram: "@candidate-before" } },
          outcome: "hired",
          pipelineStage: "closed",
        },
        operatorId: "user-a",
        operatorRole: "odc",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "ok" });

    expect(mocks.autoCloseRelatedCandidatesAfterHire).toHaveBeenCalledWith(
      expect.objectContaining({
        hiredCandidate: {
          id: "candidate-a",
          name: "候选人甲",
          poolItemId: "pool-a",
          sourceType: "public_pool",
        },
        operatorId: "user-a",
        operatorRole: "odc",
        organizationId: "org-a",
        refreshedSemanticMatches: [{ candidateId: "candidate-b", similarityScore: 94 }],
        tx,
      }),
    );
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(mocks.refreshDirectUploadDuplicateMatchesBeforeHire).toHaveBeenCalledWith({
      candidateId: "candidate-a",
      organizationId: "org-a",
    });
    expect(insertedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          automaticallyClosedCandidateCount: 1,
          automaticallyClosedCandidateIds: ["candidate-b"],
        }),
        interviewRecordId: "candidate-a",
      }),
    );
    expect(mocks.notifyCandidateStageChange).toHaveBeenCalledOnce();
    expect(mocks.notifyCandidateStageChange).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: "candidate-a", organizationId: "org-a" }),
    );
  });

  it("rejects hiring a related candidate that was already automatically closed", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      candidateName: "候选人乙",
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "archived",
      pipelineStage: "closed",
      resumeSourcePoolItemId: "pool-a",
      resumeSourceType: "public_pool",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));

    await expect(
      transitionCandidateStage({
        authorize: vi.fn().mockResolvedValue(true),
        candidateId: "candidate-b",
        input: {
          closedMeta: { hiredDetails: { preOnboardingTelegram: "@candidate-before" } },
          outcome: "hired",
          pipelineStage: "closed",
        },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({
      kind: "invalid",
      message: "该候选人已结束流程，不能再次标记录用。",
    });

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(updatedWhere).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
    expect(mocks.autoCloseRelatedCandidatesAfterHire).not.toHaveBeenCalled();
  });

  it("forbids close without candidateClose:create", async () => {
    const authorize = vi.fn().mockResolvedValue(false);

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { outcome: "rejected", pipelineStage: "closed" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(authorize).toHaveBeenCalledWith({ action: "create", resource: "candidateClose" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("checks offer readiness inside the locked transaction and records copilot provenance", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "human_interview",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));
    mocks.loadReadiness.mockResolvedValue({
      completedRoundsMissingFeedback: 0,
      pendingRounds: 0,
      totalRounds: 1,
    });
    mocks.getReadinessError.mockReturnValue(null);
    const authorize = vi.fn().mockResolvedValue(true);

    await expect(
      transitionCandidateStage({
        authorize,
        candidateId: "candidate-a",
        input: { pipelineStage: "offer" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: {
          kind: "workspace_recruiting_copilot",
          proposalId: "proposal-a",
          proposalTitle: "推进到 Offer",
        },
      }),
    ).resolves.toEqual({ kind: "ok" });

    expect(mocks.loadReadiness).toHaveBeenCalledWith("candidate-a", "org-a", tx);
    expect(updatedWhere).toHaveBeenCalledOnce();
    expect(insertedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "candidate_transition",
        detail: expect.objectContaining({
          copilotActionProposalId: "proposal-a",
          copilotActionTitle: "推进到 Offer",
          source: "workspace_recruiting_copilot",
        }),
        interviewRecordId: "candidate-a",
        operatorId: "user-a",
        organizationId: "org-a",
      }),
    );
    expect(mocks.invalidateCaches).toHaveBeenCalledWith("org-a");
  });

  it("keeps no-op transitions free of writes, audit noise, and cache invalidation", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));

    await expect(
      transitionCandidateStage({
        authorize: vi.fn().mockResolvedValue(true),
        candidateId: "candidate-a",
        input: { pipelineStage: "screening" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "noop" });

    expect(updatedWhere).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
    expect(mocks.invalidateCaches).not.toHaveBeenCalled();
  });

  it("keeps manual transition audit detail free of copilot provenance", async () => {
    const { insertedValues, tx } = createTransaction({
      closedMeta: null,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));

    await expect(
      transitionCandidateStage({
        authorize: vi.fn().mockResolvedValue(true),
        candidateId: "candidate-a",
        input: { pipelineStage: "ai_interview" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({ kind: "ok" });

    const audit = insertedValues.mock.calls[0]?.[0] as { detail?: Record<string, unknown> };
    expect(audit.detail).not.toHaveProperty("source");
    expect(audit.detail).not.toHaveProperty("copilotActionProposalId");
  });

  it("rejects advancing to AI interview when the linked job disables it", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionAiInterviewDisabled: true,
      jobDescriptionId: "jd-a",
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));

    await expect(
      transitionCandidateStage({
        authorize: vi.fn().mockResolvedValue(true),
        candidateId: "candidate-a",
        input: { pipelineStage: "ai_interview" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({
      kind: "invalid",
      message: "当前关联岗位已禁用 AI 面试。",
    });

    expect(updatedWhere).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
    expect(mocks.invalidateCaches).not.toHaveBeenCalled();
  });

  it("rejects advancing when the candidate has no linked job", async () => {
    const { insertedValues, tx, updatedWhere } = createTransaction({
      closedMeta: null,
      jobDescriptionId: null,
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    mocks.transaction.mockImplementation(async (callback) => await callback(tx));

    await expect(
      transitionCandidateStage({
        authorize: vi.fn().mockResolvedValue(true),
        candidateId: "candidate-a",
        input: { pipelineStage: "ai_interview" },
        operatorId: "user-a",
        organizationId: "org-a",
        provenance: { kind: "manual" },
      }),
    ).resolves.toEqual({
      kind: "invalid",
      message: "请先绑定在招岗位后再推进招聘阶段。",
    });

    expect(updatedWhere).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
    expect(mocks.invalidateCaches).not.toHaveBeenCalled();
  });
});
