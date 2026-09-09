import { describe, expect, it, vi } from "vitest";
import { createResumeRecordFromStorage } from "./create-from-storage";

const mocks = vi.hoisted(() => ({ values: vi.fn().mockImplementation(() => Promise.resolve()) }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Drizzle transaction callback.
    transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({ insert: () => ({ values: mocks.values }) }),
  },
}));
vi.mock("../dao/skills", () => ({
  syncResumeSkills: vi.fn().mockImplementation(() => Promise.resolve()),
}));

describe("new candidate approval stage", () => {
  it.each(["direct_upload", "private_pool", "public_pool"] as const)(
    "starts %s candidates in AI review",
    async (type) => {
      await createResumeRecordFromStorage({
        candidateEmail: null,
        candidateName: "候选人",
        candidatePhone: null,
        contentHash: null,
        jobDescriptionId: "job-1",
        notes: null,
        organizationId: "org-1",
        resumeFileName: null,
        resumeProfile: null,
        source: {
          importedAt: new Date(),
          importedBy: "user-1",
          poolItemId: type === "direct_upload" ? null : "pool-1",
          type,
        },
        storageKey: null,
        targetRole: null,
        userId: "user-1",
      });
      expect(mocks.values).toHaveBeenLastCalledWith(
        expect.objectContaining({ pipelineStage: "ai_review", resumeSourceType: type }),
      );
    },
  );
});
