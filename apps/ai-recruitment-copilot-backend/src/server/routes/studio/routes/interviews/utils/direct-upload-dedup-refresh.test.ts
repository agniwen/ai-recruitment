import { describe, expect, it, vi } from "vitest";
import { refreshDirectUploadDuplicateMatchesBeforeHire } from "./direct-upload-dedup-refresh";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {},
}));

const profile = {
  awards: [],
  certificates: [],
  educationExperiences: [],
  email: null,
  languages: [],
  name: "候选人甲",
  phone: null,
  projectExperiences: [],
  schools: [],
  skills: [],
  targetRoles: [],
  workExperiences: [],
};

describe("refreshDirectUploadDuplicateMatchesBeforeHire", () => {
  it("runs the existing dedup method synchronously and returns >=90 studio matches", async () => {
    const findDuplicates = vi.fn().mockResolvedValue([
      { id: "candidate-b", score: 94, sourceType: "studio_interview" },
      { id: "candidate-c", score: 89, sourceType: "studio_interview" },
      { id: "pool-a", score: 98, sourceType: "resume_pool_item" },
    ]);
    const replaceDuplicateSnapshot = vi.fn().mockImplementation(() => Promise.resolve());

    await expect(
      refreshDirectUploadDuplicateMatchesBeforeHire(
        { candidateId: "candidate-a", organizationId: "org-a" },
        {
          enabled: true,
          findDuplicates: findDuplicates as never,
          loadCandidate: vi.fn().mockResolvedValue({
            candidateCount: 37,
            poolItemId: null,
            profile,
            sourceType: "direct_upload",
          }),
          replaceDuplicateSnapshot: replaceDuplicateSnapshot as never,
        },
      ),
    ).resolves.toEqual([{ candidateId: "candidate-b", similarityScore: 94 }]);

    expect(findDuplicates).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeSources: [{ sourceId: "candidate-a", sourceType: "studio_interview" }],
        resultLimit: 37,
        sourceTypes: ["studio_interview"],
        throwOnError: true,
      }),
    );
    expect(replaceDuplicateSnapshot).toHaveBeenCalledOnce();
  });

  it("skips pool-derived candidates", async () => {
    const findDuplicates = vi.fn();

    await expect(
      refreshDirectUploadDuplicateMatchesBeforeHire(
        { candidateId: "candidate-a", organizationId: "org-a" },
        {
          enabled: true,
          findDuplicates: findDuplicates as never,
          loadCandidate: vi.fn().mockResolvedValue({
            candidateCount: 37,
            poolItemId: "pool-a",
            profile,
            sourceType: "public_pool",
          }),
          replaceDuplicateSnapshot: vi.fn() as never,
        },
      ),
    ).resolves.toBeUndefined();

    expect(findDuplicates).not.toHaveBeenCalled();
  });

  it("keeps stored matches as fallback when semantic indexing is disabled", async () => {
    const findDuplicates = vi.fn();
    const replaceDuplicateSnapshot = vi.fn();

    await expect(
      refreshDirectUploadDuplicateMatchesBeforeHire(
        { candidateId: "candidate-a", organizationId: "org-a" },
        {
          enabled: false,
          findDuplicates: findDuplicates as never,
          loadCandidate: vi.fn().mockResolvedValue({
            candidateCount: 37,
            poolItemId: null,
            profile,
            sourceType: "direct_upload",
          }),
          replaceDuplicateSnapshot: replaceDuplicateSnapshot as never,
        },
      ),
    ).resolves.toBeUndefined();

    expect(findDuplicates).not.toHaveBeenCalled();
    expect(replaceDuplicateSnapshot).not.toHaveBeenCalled();
  });

  it("propagates dedup failures so a hire cannot silently bypass duplicate closure", async () => {
    const error = new Error("dedup unavailable");

    await expect(
      refreshDirectUploadDuplicateMatchesBeforeHire(
        { candidateId: "candidate-a", organizationId: "org-a" },
        {
          enabled: true,
          findDuplicates: vi.fn().mockRejectedValue(error) as never,
          loadCandidate: vi.fn().mockResolvedValue({
            candidateCount: 37,
            poolItemId: null,
            profile,
            sourceType: null,
          }),
          replaceDuplicateSnapshot: vi.fn() as never,
        },
      ),
    ).rejects.toThrow("dedup unavailable");
  });
});
