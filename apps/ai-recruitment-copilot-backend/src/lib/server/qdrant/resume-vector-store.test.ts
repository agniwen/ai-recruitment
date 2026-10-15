import { describe, expect, it, vi } from "vitest";
import { isSourceType, QdrantResumeVectorStore } from "./resume-vector-store";

describe("isSourceType", () => {
  it("接受 job_description", () => {
    expect(isSourceType("job_description")).toBe(true);
  });
});

it("applies authorized source ids inside the vector query, before the result limit", async () => {
  const client = {
    collectionExists: vi.fn(),
    createCollection: vi.fn(),
    createPayloadIndex: vi.fn(),
    delete: vi.fn(),
    getCollection: vi.fn(),
    query: vi.fn().mockResolvedValue({ points: [] }),
    scroll: vi.fn(),
    upsert: vi.fn(),
  };
  const store = new QdrantResumeVectorStore({
    client,
    dimensions: 1,
    url: "http://localhost:6333",
  });
  await store.searchSimilarResumes({
    allowedSourceIds: ["authorized-job"],
    chunkType: "skill_role",
    embedding: [1],
    limit: 20,
    organizationId: "org",
    sourceTypes: ["job_description"],
  });
  expect(client.query.mock.calls[0]?.[1].filter.must).toContainEqual({
    key: "sourceId",
    match: { any: ["authorized-job"] },
  });
  client.query.mockClear();
  await store.searchSimilarResumes({
    allowedSourceIds: [],
    chunkType: "skill_role",
    embedding: [1],
    limit: 20,
    organizationId: "org",
  });
  expect(client.query).not.toHaveBeenCalled();
});
