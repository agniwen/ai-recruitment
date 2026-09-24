import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { organization, resumeDuplicateMatch, studioInterview, user } from "@arc/db-schema/schema";
import { listActiveDuplicateMatchCounts, listDuplicateMatchesForSource } from "./duplicate-matches";

const ORG = "dedup_cross_uploader_org";
const USER_A = "dedup_cross_uploader_a";
const USER_B = "dedup_cross_uploader_b";

async function cleanup() {
  await db.delete(resumeDuplicateMatch).where(eq(resumeDuplicateMatch.organizationId, ORG));
  await db.delete(studioInterview).where(eq(studioInterview.organizationId, ORG));
  await db.delete(organization).where(eq(organization.id, ORG));
  await db.delete(user).where(eq(user.id, USER_A));
  await db.delete(user).where(eq(user.id, USER_B));
}

beforeEach(async () => {
  await cleanup();
  const now = new Date("2026-09-24T00:00:00.000Z");
  await db.insert(user).values([
    {
      createdAt: now,
      email: "dedup-a@example.com",
      emailVerified: false,
      id: USER_A,
      name: "甲",
      updatedAt: now,
    },
    {
      createdAt: now,
      email: "dedup-b@example.com",
      emailVerified: false,
      id: USER_B,
      name: "乙",
      updatedAt: now,
    },
  ]);
  await db.insert(organization).values({ createdAt: now, id: ORG, name: "查重测试", slug: ORG });
  await db.insert(studioInterview).values([
    { candidateName: "来源", createdBy: USER_A, id: "dedup_source", organizationId: ORG },
    { candidateName: "同一上传人", createdBy: USER_A, id: "dedup_same", organizationId: ORG },
    { candidateName: "其他上传人", createdBy: USER_B, id: "dedup_other", organizationId: ORG },
  ]);
  await db.insert(resumeDuplicateMatch).values(
    [
      { matchedSourceId: "dedup_same", sourceId: "dedup_source" },
      { matchedSourceId: "dedup_other", sourceId: "dedup_source" },
      { matchedSourceId: "dedup_source", sourceId: "dedup_other" },
    ].map(({ sourceId, matchedSourceId }) => ({
      embeddingVersion: "test-v1",
      id: `match_${sourceId}_${matchedSourceId}`,
      level: "high" as const,
      matchedSourceId,
      matchedSourceType: "studio_interview" as const,
      organizationId: ORG,
      score: 95,
      sourceId,
      sourceType: "studio_interview" as const,
    })),
  );
});

afterEach(cleanup);

describe("stored duplicate matches", () => {
  it("excludes same-uploader matches from badges and details", async () => {
    const counts = await listActiveDuplicateMatchCounts({
      organizationId: ORG,
      sourceIds: ["dedup_source", "dedup_other"],
      sourceType: "studio_interview",
    });
    expect(counts.get("dedup_source")?.count).toBe(1);
    expect(counts.get("dedup_other")?.count).toBe(1);

    const details = await listDuplicateMatchesForSource({
      organizationId: ORG,
      sourceId: "dedup_source",
      sourceType: "studio_interview",
      visibilityScope: { kind: "all" },
    });
    expect(details.map((match) => match.id)).toEqual(["dedup_other"]);
  });
});
