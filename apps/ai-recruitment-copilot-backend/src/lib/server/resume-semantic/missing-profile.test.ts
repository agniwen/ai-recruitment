import { describe, expect, it } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { hashResumeProfileForSemanticIndex } from "./profile-hash";
import { rerankResumeDuplicate } from "./rerank";
import { buildResumeSemanticTexts } from "./text-builders";

const partial = {
  educationExperiences: [null, { school: "某大学" }],
  name: "候选人",
  projectExperiences: [null, { name: "项目", techStack: null }],
  workExperiences: null,
} as unknown as ResumeProfile;

describe("semantic consumers with missing resume objects", () => {
  it("builds text and hashes without dereferencing absent lists or entries", () => {
    const chunks = buildResumeSemanticTexts(partial);
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("某大学");
    expect(hashResumeProfileForSemanticIndex(partial)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("compares incomplete profiles safely", () => {
    const result = rerankResumeDuplicate({
      candidateProfile: partial,
      queryProfile: partial,
      vectorScores: {},
    });
    expect(Number.isFinite(result.score)).toBe(true);
  });
});
