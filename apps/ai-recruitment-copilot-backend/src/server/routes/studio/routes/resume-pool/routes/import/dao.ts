import { validateImportDestinations } from "./validation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { resumePoolEvent, resumePoolImport, studioInterview } from "@arc/db-schema/schema";
import type {
  ResumePoolBatchImportInput,
  ResumePoolBatchImportResult,
} from "@arc/shared/resume-pool";
import { findSemanticResumeDuplicates } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/dedup-service";
import { enqueueResumeSemanticIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue";
import { enqueueResumeReviewGenerationForRecordBestEffort } from "../../../resumes/utils/review-queue";
import { createResumeRecordFromStorage } from "../../../resumes/utils/create-from-storage";
import { loadAccessiblePoolItem } from "../../dao";
import { loadResumePoolImportOptions } from "./options";

export async function batchImportResumePoolItem(
  input: ResumePoolBatchImportInput & {
    organizationId: string;
    poolItemId: string;
    userId: string;
    userRole?: string | null;
  },
): Promise<ResumePoolBatchImportResult> {
  const source = await loadAccessiblePoolItem({
    organizationId: input.organizationId,
    poolItemId: input.poolItemId,
    userId: input.userId,
  });
  if (!source) {
    throw new Error("简历池记录不存在或无权访问。");
  }
  if (source.resumeParseStatus !== "ready") {
    throw new Error("简历解析完成后才能入库。");
  }
  const options = await loadResumePoolImportOptions(input.organizationId, input.userId);
  const destinations = validateImportDestinations(input, options, true);
  const records = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`pool-batch:${input.organizationId}:${input.poolItemId}:${input.requestId}`}, 0))`,
    );
    const existing = await tx
      .select({
        jobDescriptionId: studioInterview.jobDescriptionId,
        resumeRecordId: studioInterview.id,
      })
      .from(resumePoolEvent)
      .innerJoin(
        studioInterview,
        and(
          eq(studioInterview.organizationId, input.organizationId),
          sql`${studioInterview.id} = ${resumePoolEvent.payload}->>'resumeRecordId'`,
        ),
      )
      .where(
        and(
          eq(resumePoolEvent.organizationId, input.organizationId),
          eq(resumePoolEvent.poolItemId, input.poolItemId),
          eq(resumePoolEvent.actorId, input.userId),
          eq(resumePoolEvent.type, "imported"),
          sql`${resumePoolEvent.payload}->>'requestId' = ${input.requestId}`,
        ),
      );
    if (existing.length) {
      return existing;
    }
    // Check once for the entire batch, before any destination is created.
    if (input.dedupPolicy === "check") {
      const matches = await findSemanticResumeDuplicates({
        email: source.candidateEmail ?? source.resumeProfile?.email ?? null,
        name: source.candidateName ?? source.resumeProfile?.name ?? null,
        organizationId: input.organizationId,
        phone: source.candidatePhone ?? source.resumeProfile?.phone ?? null,
        resumeProfile: source.resumeProfile,
        sourceTypes: ["studio_interview"],
        uploaderUserId: input.userId,
      });
      if (matches.length) {
        return { matches, status: "duplicate_found" as const };
      }
    }
    const created = [];
    for (const destination of destinations) {
      const importedAt = new Date();
      const resumeRecordId = await createResumeRecordFromStorage(
        {
          candidateEmail: source.candidateEmail,
          candidateName: source.candidateName,
          candidatePhone: source.candidatePhone,
          contentHash: source.resumeContentHash,
          hiringUnitId: destination.hiringUnitId,
          jobDescriptionId: destination.jobDescriptionId,
          notes: source.notes,
          organizationId: input.organizationId,
          recommendationText: input.recommendationText,
          recruitmentSource: source.recruitmentSource,
          recruitmentSourceDetail: source.recruitmentSourceDetail,
          resumeFileName: source.resumeFileName,
          resumeParseStatus: "ready",
          resumeProfile: source.resumeProfile,
          resumeText: source.resumeText,
          source: {
            importedAt,
            importedBy: input.userId,
            poolItemId: source.id,
            type: source.scope === "public" ? "public_pool" : "private_pool",
          },
          storageKey: source.resumeStorageKey,
          targetRole: source.targetRole,
          userId: input.userId,
          userRole: input.userRole,
        },
        tx,
      );
      await tx.insert(resumePoolImport).values({
        id: crypto.randomUUID(),
        importedAt,
        importedBy: input.userId,
        importedResumeRecordId: resumeRecordId,
        organizationId: input.organizationId,
        poolItemId: source.id,
      });
      await tx.insert(resumePoolEvent).values({
        actorId: input.userId,
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        payload: { destination, requestId: input.requestId, resumeRecordId },
        poolItemId: source.id,
        type: "imported",
      });
      created.push({ jobDescriptionId: destination.jobDescriptionId, resumeRecordId });
    }
    return created;
  });
  if (!Array.isArray(records)) {
    return records;
  }
  // Parsing is reused; only indexing and job-specific evaluation run after commit.
  for (const record of records) {
    await enqueueResumeSemanticIndexJobBestEffort({
      organizationId: input.organizationId,
      sourceId: record.resumeRecordId,
      sourceType: "studio_interview",
    });
    if (record.jobDescriptionId) {
      await enqueueResumeReviewGenerationForRecordBestEffort({
        jobDescriptionId: record.jobDescriptionId,
        organizationId: input.organizationId,
        poolItemId: source.id,
        resumeRecordId: record.resumeRecordId,
        source: "resume_pool_import",
      });
    }
  }
  return { records, status: "imported" };
}
