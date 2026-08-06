import { beforeEach, describe, expect, it, vi } from "vitest";
import { transitionCandidateStage } from "./candidate-stage-transition";

// oxlint-disable promise/prefer-await-to-callbacks -- the fake transaction must execute Drizzle's callback.

const mocks = vi.hoisted(() => ({
  getReadinessError: vi.fn(),
  invalidateCaches: vi.fn(),
  loadReadiness: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidateCaches,
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds",
  () => ({
    getHumanInterviewOfferReadinessError: mocks.getReadinessError,
    loadHumanInterviewRoundReadiness: mocks.loadReadiness,
  }),
);

function createTransaction(existing: {
  closedMeta: null;
  jobDescriptionAiInterviewDisabled?: boolean;
  jobDescriptionId: string | null;
  outcome: "in_pipeline";
  pipelineStage: "human_interview" | "screening";
}) {
  const insertedValues = vi.fn(async (_value: unknown) => {});
  const updatedWhere = vi.fn(async (_value: unknown) => {});
  const tx = {
    insert: vi.fn(() => ({ values: insertedValues })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([existing]) })),
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
    const authorize = vi.fn(
      async ({ action, resource }) => resource === "offer" && action === "create",
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
    const authorize = vi.fn(
      async ({ action, resource }) => resource === "humanInterview" && action === "create",
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
    const authorize = vi.fn(
      async ({ action, resource }) => resource === "candidateClose" && action === "create",
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
