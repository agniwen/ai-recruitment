import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resumePoolItem,
  resumeUploadBatch,
  resumeUploadBatchItem,
  studioInterview,
} from "@arc/db-schema/schema";
import { insertBatchWithItems } from "./batches";

const mocks = vi.hoisted(() => ({ rows: new Map<unknown, Record<string, unknown>[]>() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({
        insert: (table: unknown) => ({
          values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
            mocks.rows.set(table, Array.isArray(rows) ? rows : [rows]);
          },
        }),
      }),
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/duplicate-matches", () => ({
  deleteDuplicateMatchesForSource: vi.fn(),
}));

beforeEach(() => mocks.rows.clear());

const input = {
  dedupPolicy: "create" as const,
  files: ["one.pdf", "two.pdf"].map((name) => ({
    contentHash: name,
    fileSize: 42,
    originalFileName: name,
    storageKey: `uploads/${name}`,
  })),
  jdMode: "none" as const,
  jobDescriptionId: null,
  organizationId: "org",
  userId: "uploader",
};

describe("candidate upload private pool copy", () => {
  it("creates one uploader-owned private copy per candidate in the same batch transaction", async () => {
    await insertBatchWithItems({ ...input, resumePoolScope: "public", target: "resume_library" });
    const records = mocks.rows.get(studioInterview) ?? [];
    const copies = mocks.rows.get(resumePoolItem) ?? [];
    const items = mocks.rows.get(resumeUploadBatchItem) ?? [];
    expect(records).toHaveLength(2);
    expect(copies).toHaveLength(2);
    for (const [index, copy] of copies.entries()) {
      expect(copy).toMatchObject({
        createdBy: "uploader",
        organizationId: "org",
        publishedAt: null,
        publishedBy: null,
        resumeParseStatus: "queued",
        resumeStorageKey: records[index].resumeStorageKey,
        scope: "private",
        sourceUserId: null,
      });
      expect(items[index]).toMatchObject({
        poolItemId: copy.id,
        resumeRecordId: records[index].id,
      });
    }
  });

  it("keeps direct pool uploads as one pool record without creating candidates", async () => {
    await insertBatchWithItems({ ...input, resumePoolScope: "public", target: "resume_pool" });
    expect(mocks.rows.has(studioInterview)).toBe(false);
    expect(mocks.rows.get(resumePoolItem)).toHaveLength(2);
    expect(mocks.rows.get(resumePoolItem)?.[0].scope).toBe("public");
  });
});

it("creates one item per file and concrete JD with the correct hiring organization", async () => {
  await insertBatchWithItems({
    ...input,
    destinations: [
      { hiringUnitId: "one", jobDescriptionId: "jd-one" },
      { hiringUnitId: "two", jobDescriptionId: "jd-two" },
    ],
    jdMode: "bind",
  });
  expect(mocks.rows.get(resumeUploadBatch)?.[0]).toMatchObject({
    jdMode: "bind",
    jobDescriptionId: null,
    totalCount: 4,
  });
  const records = mocks.rows.get(studioInterview) ?? [];
  expect(records).toHaveLength(4);
  expect(records.map((row) => [row.hiringUnitId, row.jobDescriptionId])).toEqual([
    ["one", "jd-one"],
    ["two", "jd-two"],
    ["one", "jd-one"],
    ["two", "jd-two"],
  ]);
  expect(mocks.rows.get(resumeUploadBatchItem)?.map((row) => row.orderIndex)).toEqual([0, 1, 2, 3]);
  expect(mocks.rows.get(resumePoolItem)?.map((row) => row.jobDescriptionId)).toEqual([
    "jd-one",
    "jd-two",
    "jd-one",
    "jd-two",
  ]);
});

it.each([1, 2])(
  "expands %i files into four distinct candidate flows per file",
  async (fileCount) => {
    const destinations = [
      { hiringUnitId: "tech", jobDescriptionId: "REQ-001081" },
      { hiringUnitId: "tech", jobDescriptionId: "REQ-000940" },
      { hiringUnitId: "operations-a", jobDescriptionId: "REQ-001027" },
      { hiringUnitId: "operations-b", jobDescriptionId: "REQ-000200" },
    ];
    await insertBatchWithItems({
      ...input,
      destinations,
      files: input.files.slice(0, fileCount),
      jdMode: "bind",
    });
    const records = mocks.rows.get(studioInterview) ?? [];
    const items = mocks.rows.get(resumeUploadBatchItem) ?? [];
    expect(mocks.rows.get(resumeUploadBatch)?.[0].totalCount).toBe(fileCount * 4);
    expect(new Set(records.map((row) => row.id)).size).toBe(fileCount * 4);
    expect(records).toEqual(
      input.files.slice(0, fileCount).flatMap((file) =>
        destinations.map((destination) =>
          expect.objectContaining({
            ...destination,
            pipelineStage: "ai_review",
            resumeStorageKey: file.storageKey,
          }),
        ),
      ),
    );
    expect(items.map((item) => item.resumeRecordId)).toEqual(records.map((record) => record.id));
    expect(mocks.rows.get(resumePoolItem)?.map((copy) => copy.jobDescriptionId)).toEqual(
      records.map((record) => record.jobDescriptionId),
    );
  },
);
