import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchImportResumePoolItem } from "./dao";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  duplicates: vi.fn(),
  index: vi.fn(),
  options: vi.fn(),
  review: vi.fn(),
  source: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock("../../dao", () => ({ loadAccessiblePoolItem: mocks.source }));
vi.mock("./options", () => ({ loadResumePoolImportOptions: mocks.options }));
vi.mock("../../../resumes/utils/create-from-storage", () => ({
  createResumeRecordFromStorage: mocks.create,
}));
vi.mock("../../../resumes/utils/review-queue", () => ({
  enqueueResumeReviewGenerationForRecordBestEffort: mocks.review,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/dedup-service", () => ({
  findSemanticResumeDuplicates: mocks.duplicates,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue", () => ({
  enqueueResumeSemanticIndexJobBestEffort: mocks.index,
}));
const profile = { name: "候选人", skills: ["React"] };
const input = {
  dedupPolicy: "check" as const,
  destinations: ["one", "two"].map((hiringUnitId) => ({
    departmentId: null,
    hiringUnitId,
    jobDescriptionId: null,
    serviceUnit: null,
  })),
  jobDescriptionMode: "none" as const,
  organizationId: "org",
  poolItemId: "pool",
  recommendationText: "推荐",
  requestId: "request",
  userId: "user",
};
let committed: unknown[];
const inserted = vi.fn();
let existing: { resumeRecordId: string; jobDescriptionId: null }[];
beforeEach(() => {
  vi.clearAllMocks();
  committed = [];
  existing = [];
  mocks.source.mockResolvedValue({
    id: "pool",
    resumeParseStatus: "ready",
    resumeProfile: profile,
    resumeStorageKey: "file",
    resumeText: "parsed",
    scope: "private",
  });
  mocks.options.mockResolvedValue({
    departments: [],
    hiringUnits: [{ id: "one" }, { id: "two" }],
    jobDescriptions: [],
  });
  mocks.duplicates.mockResolvedValue([]);
  mocks.create.mockImplementation((_input, tx) => {
    tx.staged.push(_input);
    return Promise.resolve(`record-${tx.staged.length}`);
  });
  mocks.transaction.mockImplementation(async (operation) => {
    const tx = {
      execute: vi.fn(),
      insert: () => ({ values: inserted }),
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(existing) }) }),
      }),
      staged: [] as unknown[],
    };
    const result = await operation(tx);
    committed = tx.staged;
    return result;
  });
});

describe("batch admission transaction", () => {
  it("creates a candidate for each destination in the same transaction", async () => {
    const result = await batchImportResumePoolItem(input);
    expect(result.status).toBe("imported");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(committed).toHaveLength(2);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const hiringUnitId of ["one", "two"]) {
      expect(inserted).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            destination: expect.objectContaining({ hiringUnitId }),
          }),
        }),
      );
    }
    for (const [created] of mocks.create.mock.calls) {
      expect(created.resumeProfile).toBe(profile);
      expect(created.resumeParseStatus).toBe("ready");
      expect(created.resumeText).toBe("parsed");
    }
    expect(mocks.duplicates).toHaveBeenCalledTimes(1);
    expect(mocks.index).toHaveBeenCalledTimes(2);
  });
  it("rolls back the candidate when saving recommendation metadata fails", async () => {
    inserted
      .mockReturnValueOnce(Promise.resolve())
      .mockRejectedValueOnce(new Error("insert failed"));
    await expect(batchImportResumePoolItem(input)).rejects.toThrow("insert failed");
    expect(committed).toEqual([]);
    expect(mocks.index).not.toHaveBeenCalled();
  });
  it("rolls back all records when the second candidate cannot be created", async () => {
    mocks.create.mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("second failed"));
    await expect(batchImportResumePoolItem(input)).rejects.toThrow("second failed");
    expect(committed).toEqual([]);
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("binds and evaluates each record against its own JD", async () => {
    const jobs = ["one", "two"].map((hiringUnitId) => ({
      departmentId: `dept-${hiringUnitId}`,
      departmentName: hiringUnitId,
      hiringUnitId,
      id: `jd-${hiringUnitId}`,
      name: "前端",
      serviceUnit: null,
    }));
    mocks.options.mockResolvedValue({
      departments: [],
      hiringUnits: [{ id: "one" }, { id: "two" }],
      jobDescriptions: jobs,
    });
    await batchImportResumePoolItem({
      ...input,
      destinations: input.destinations.map((row) => ({
        ...row,
        jobDescriptionId: `jd-${row.hiringUnitId}`,
      })),
      jobDescriptionMode: "bind",
    });
    for (const [index, job] of jobs.entries()) {
      expect(mocks.create.mock.calls[index][0]).toMatchObject({
        hiringUnitId: job.hiringUnitId,
        jobDescriptionId: job.id,
      });
      expect(mocks.review).toHaveBeenCalledWith(
        expect.objectContaining({
          jobDescriptionId: job.id,
          resumeRecordId: `record-${index + 1}`,
        }),
      );
    }
  });
  it("returns duplicate confirmation before creating any records", async () => {
    mocks.duplicates.mockResolvedValue([{ id: "duplicate" }]);
    const result = await batchImportResumePoolItem(input);
    expect(result.status).toBe("duplicate_found");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("reuses the same batch on retry without creating or deduplicating again", async () => {
    existing = [{ jobDescriptionId: null, resumeRecordId: "existing" }];
    expect(await batchImportResumePoolItem(input)).toEqual({
      records: existing,
      status: "imported",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.duplicates).not.toHaveBeenCalled();
  });
});
