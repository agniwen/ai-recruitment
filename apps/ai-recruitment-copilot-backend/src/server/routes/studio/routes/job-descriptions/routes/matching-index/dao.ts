import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { hashJobDescriptionForSemanticIndex } from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/hash";
import {
  department,
  jobDescription,
  jobMatchingProfile,
  resumeSemanticIndex,
} from "@arc/db-schema/schema";
import { selectableJobDescriptionCondition } from "../../dao";

export function loadJobMatchingIndexRows(organizationId: string, embeddingVersion: string) {
  return db
    .select({
      departmentName: department.name,
      indexHash: resumeSemanticIndex.profileHash,
      indexStatus: resumeSemanticIndex.status,
      job: jobDescription,
      profile: jobMatchingProfile.profile,
    })
    .from(jobDescription)
    .leftJoin(department, eq(department.id, jobDescription.departmentId))
    .leftJoin(jobMatchingProfile, eq(jobMatchingProfile.jobDescriptionId, jobDescription.id))
    .leftJoin(
      resumeSemanticIndex,
      and(
        eq(resumeSemanticIndex.sourceId, jobDescription.id),
        eq(resumeSemanticIndex.organizationId, organizationId),
        eq(resumeSemanticIndex.sourceType, "job_description"),
        eq(resumeSemanticIndex.embeddingVersion, embeddingVersion),
      ),
    )
    .where(
      and(eq(jobDescription.organizationId, organizationId), selectableJobDescriptionCondition),
    );
}

export type JobMatchingIndexRow = Awaited<ReturnType<typeof loadJobMatchingIndexRows>>[number];

export function jobMatchingIndexHash(row: JobMatchingIndexRow) {
  return hashJobDescriptionForSemanticIndex({
    ...row.job,
    departmentName: row.departmentName,
    matchingProfileText: row.profile ? JSON.stringify(row.profile) : null,
  });
}

export async function markJobMatchingIndexesPending(
  organizationId: string,
  rows: JobMatchingIndexRow[],
  config: { model: string; embeddingVersion: string },
) {
  if (!rows.length) {
    return;
  }
  await db
    .insert(resumeSemanticIndex)
    .values(
      rows.map((row) => ({
        embeddingModel: config.model,
        embeddingVersion: config.embeddingVersion,
        errorMessage: null,
        id: `job_description:${row.job.id}:${config.embeddingVersion}`,
        organizationId,
        profileHash: jobMatchingIndexHash(row),
        sourceId: row.job.id,
        sourceType: "job_description" as const,
        status: "pending" as const,
      })),
    )
    .onConflictDoUpdate({
      set: {
        embeddingModel: config.model,
        errorMessage: null,
        profileHash: sql`excluded.profile_hash`,
        status: "pending",
        updatedAt: new Date(),
      },
      target: [
        resumeSemanticIndex.sourceType,
        resumeSemanticIndex.sourceId,
        resumeSemanticIndex.embeddingVersion,
      ],
    });
}

export async function markJobMatchingEnqueueFailed(
  organizationId: string,
  sourceIds: string[],
  embeddingVersion: string,
) {
  if (!sourceIds.length) {
    return;
  }
  await db
    .update(resumeSemanticIndex)
    .set({
      errorMessage: "岗位向量任务入队失败，请稍后重试。",
      status: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(resumeSemanticIndex.organizationId, organizationId),
        eq(resumeSemanticIndex.sourceType, "job_description"),
        eq(resumeSemanticIndex.embeddingVersion, embeddingVersion),
        inArray(resumeSemanticIndex.sourceId, sourceIds),
        eq(resumeSemanticIndex.status, "pending"),
      ),
    );
}
