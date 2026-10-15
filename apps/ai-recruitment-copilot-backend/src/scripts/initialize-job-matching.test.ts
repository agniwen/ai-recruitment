import { describe, expect, it } from "vitest";
import { hashJobDescriptionForSemanticIndex } from "../lib/server/jd-semantic/hash";
import { buildJobDescriptionSemanticTexts } from "../lib/server/resume-semantic/text-builders";
import { hasCurrentJobVectors } from "./initialize-job-matching";

const source = {
  departmentName: "研发",
  description: null,
  id: "job",
  matchingProfileText: "React",
  name: "前端工程师",
  prompt: "负责 React 开发",
};
const config = { dimensions: 3, embeddingVersion: "test-v1", model: "test-embedding" };
const stored = () =>
  buildJobDescriptionSemanticTexts(source).map((chunk) => ({
    chunkType: chunk.chunkType,
    contentHash: null,
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: config.model,
    embeddingVersion: config.embeddingVersion,
    organizationId: "org",
    profileHash: hashJobDescriptionForSemanticIndex(source),
    sourceId: source.id,
    sourceType: "job_description" as const,
    status: "active" as const,
  }));

describe("job vector initialization verification", () => {
  it("requires all chunks even when the DB is already marked indexed", () => {
    expect(hasCurrentJobVectors(source, stored(), config)).toBe(true);
    expect(hasCurrentJobVectors(source, [], config)).toBe(false);
    expect(hasCurrentJobVectors(source, stored().slice(1), config)).toBe(false);
    expect(hasCurrentJobVectors(source, [stored()[0], stored()[0], stored()[0]], config)).toBe(
      false,
    );
  });
  it("rejects stale content, versions, models, dimensions and archived vectors", () => {
    const changes = [
      { profileHash: "old" },
      { embeddingVersion: "old" },
      { embeddingModel: "old" },
      { embedding: [0.1] },
      { status: "archived" as const },
    ];
    for (const change of changes) {
      expect(
        hasCurrentJobVectors(
          source,
          stored().map((chunk) => ({ ...chunk, ...change })),
          config,
        ),
      ).toBe(false);
    }
  });
});
