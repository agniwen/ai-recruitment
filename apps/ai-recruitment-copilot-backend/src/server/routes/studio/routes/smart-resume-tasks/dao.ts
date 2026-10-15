import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  resumePoolEvent,
  resumePoolImport,
  resumePoolItem,
  resumeUploadBatch,
  resumeUploadBatchItem,
  smartResumeTask,
  smartResumeTaskItem,
  studioInterview,
} from "@arc/db-schema/schema";
import type {
  smartResumeTaskDraftSchema,
  SmartResumeTaskDto,
  SmartResumeTaskItemDto,
  SmartResumeTaskSummary,
} from "@arc/shared/smart-resume-upload";
import { isSmartResumeTaskSourceComplete } from "@arc/shared/smart-resume-upload";
import { resumeRecruitmentSourceNeedsDetail } from "@arc/shared/bulk-resume-upload";
import type { z } from "zod";
import { loadEligibleSmartJobs } from "./utils/jobs";
import { validatePortfolioAttachments } from "../resumes/utils/portfolio-attachments";
import { createResumeRecordFromStorage } from "../resumes/utils/create-from-storage";
import { enqueueResumeReviewGenerationForRecordBestEffort } from "../resumes/utils/review-queue";
import { enqueueResumeSemanticIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Draft = z.infer<typeof smartResumeTaskDraftSchema>;
type ItemDraft = NonNullable<Draft["items"]>[number];
const { id: poolIdColumn, ...poolColumns } = getTableColumns(resumePoolItem);

const ownedTask = (id: string, organizationId: string, userId: string) =>
  and(
    eq(smartResumeTask.id, id),
    eq(smartResumeTask.organizationId, organizationId),
    eq(smartResumeTask.createdBy, userId),
  );

function itemDisplayStatus(upload: string, status: SmartResumeTaskItemDto["status"]) {
  if (upload === "failed" || upload === "cancelled") {
    return "failed";
  }
  if (upload === "processing") {
    return "processing";
  }
  return status;
}

export async function loadSmartTask(
  id: string,
  organizationId: string,
  userId: string,
): Promise<SmartResumeTaskDto | null> {
  const [row] = await db
    .select({
      recruitmentSource: resumeUploadBatch.recruitmentSource,
      recruitmentSourceDetail: resumeUploadBatch.recruitmentSourceDetail,
      task: smartResumeTask,
    })
    .from(smartResumeTask)
    .innerJoin(resumeUploadBatch, eq(resumeUploadBatch.id, smartResumeTask.id))
    .where(ownedTask(id, organizationId, userId));
  if (!row) {
    return null;
  }
  const { task, recruitmentSource, recruitmentSourceDetail } = row;
  const rows = await db
    .select({
      item: smartResumeTaskItem,
      name: resumePoolItem.candidateName,
      upload: resumeUploadBatchItem,
    })
    .from(smartResumeTaskItem)
    .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
    .leftJoin(resumePoolItem, eq(resumePoolItem.id, resumeUploadBatchItem.poolItemId))
    .where(eq(smartResumeTaskItem.taskId, id))
    .orderBy(asc(resumeUploadBatchItem.orderIndex));
  return {
    createdAt: task.createdAt.toISOString(),
    id,
    items: rows.map(({ item, upload, name }) => ({
      candidateName: name,
      createdRecordIds: item.createdRecordIds,
      error: upload.errorMessage ?? item.error,
      fileName: upload.originalFileName,
      id: item.id,
      portfolioAttachments: item.portfolioAttachments,
      result: item.result,
      selectedJobIds: item.selectedJobIds,
      skipped: item.skipped,
      status: itemDisplayStatus(upload.status, item.status),
    })),
    recruitmentSource,
    recruitmentSourceDetail,
    submittedAt: task.submittedAt?.toISOString() ?? null,
  };
}

export async function listUnsubmittedSmartTasks(
  organizationId: string,
  userId: string,
): Promise<SmartResumeTaskSummary[]> {
  const rows = await db
    .select({
      createdAt: smartResumeTask.createdAt,
      failed: sql<number>`count(*) filter (where ${smartResumeTaskItem.status} = 'failed' or ${resumeUploadBatchItem.status} in ('failed', 'cancelled'))::int`,
      id: smartResumeTask.id,
      ready: sql<number>`count(*) filter (where ${smartResumeTaskItem.status} = 'ready' and ${resumeUploadBatchItem.status} = 'succeeded')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(smartResumeTask)
    .innerJoin(smartResumeTaskItem, eq(smartResumeTaskItem.taskId, smartResumeTask.id))
    .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
    .where(
      and(
        eq(smartResumeTask.organizationId, organizationId),
        eq(smartResumeTask.createdBy, userId),
        isNull(smartResumeTask.submittedAt),
      ),
    )
    .groupBy(smartResumeTask.id)
    .orderBy(desc(smartResumeTask.createdAt));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

async function lockTask(tx: Tx, id: string, organizationId: string, userId: string) {
  const [task] = await tx
    .select()
    .from(smartResumeTask)
    .where(ownedTask(id, organizationId, userId))
    .for("update");
  if (!task) {
    throw new Error("任务不存在或无权访问。");
  }
  return task;
}

async function saveTaskSource(tx: Tx, id: string, draft: Draft) {
  const [batch] = await tx.select().from(resumeUploadBatch).where(eq(resumeUploadBatch.id, id));
  if (!batch) {
    throw new Error("上传任务不存在。");
  }
  const recruitmentSource =
    draft.recruitmentSource === undefined ? batch.recruitmentSource : draft.recruitmentSource;
  let detail = draft.recruitmentSourceDetail;
  if (detail === undefined) {
    detail = recruitmentSource === batch.recruitmentSource ? batch.recruitmentSourceDetail : null;
  }
  const recruitmentSourceDetail = resumeRecruitmentSourceNeedsDetail(recruitmentSource)
    ? detail?.trim() || null
    : null;
  const source = { recruitmentSource, recruitmentSourceDetail, updatedAt: new Date() };
  await tx.update(resumeUploadBatch).set(source).where(eq(resumeUploadBatch.id, id));
  await tx
    .update(resumePoolItem)
    .set({ ...source, sourceChannel: recruitmentSource === "referral" ? "referral" : null })
    .where(
      inArray(
        resumePoolItem.id,
        tx
          .select({ id: resumeUploadBatchItem.poolItemId })
          .from(resumeUploadBatchItem)
          .where(eq(resumeUploadBatchItem.batchId, id)),
      ),
    );
}

async function validateDraftPortfolios(items: ItemDraft[], organizationId: string, userId: string) {
  for (const item of items) {
    if (
      item.portfolioAttachments !== undefined &&
      !(await validatePortfolioAttachments(item.portfolioAttachments, organizationId, userId))
    ) {
      throw new Error("部分作品集未上传成功或无权访问，请重新添加。");
    }
  }
}

function itemDraftChanges(
  stored: typeof smartResumeTaskItem.$inferSelect,
  draft: ItemDraft,
  allowedJobIds: Set<string>,
) {
  const changes: Partial<typeof smartResumeTaskItem.$inferInsert> = {};
  if (draft.jobDescriptionIds !== undefined || draft.skipped !== undefined) {
    const skipped = draft.skipped ?? stored.skipped;
    const selectedJobIds = skipped ? [] : (draft.jobDescriptionIds ?? stored.selectedJobIds);
    if (selectedJobIds.some((jobId) => !allowedJobIds.has(jobId))) {
      throw new Error("所选岗位已失效或无权访问，请重新选择。");
    }
    Object.assign(changes, { selectedJobIds, selectionTouched: true, skipped });
  }
  if (draft.portfolioAttachments !== undefined) {
    changes.portfolioAttachments = draft.portfolioAttachments;
  }
  return changes;
}

async function saveTaskItemDrafts(
  tx: Tx,
  id: string,
  drafts: ItemDraft[],
  allowedJobIds: Set<string>,
) {
  const items = await tx
    .select()
    .from(smartResumeTaskItem)
    .where(eq(smartResumeTaskItem.taskId, id));
  const byId = new Map(items.map((item) => [item.id, item]));
  if (new Set(drafts.map((item) => item.itemId)).size !== drafts.length) {
    throw new Error("任务文件列表已变化，请重新打开。");
  }
  for (const draft of drafts) {
    const stored = byId.get(draft.itemId);
    if (!stored) {
      throw new Error("任务文件列表已变化，请重新打开。");
    }
    await tx
      .update(smartResumeTaskItem)
      .set(itemDraftChanges(stored, draft, allowedJobIds))
      .where(eq(smartResumeTaskItem.id, draft.itemId));
  }
}

export async function saveSmartTaskDraft(
  id: string,
  organizationId: string,
  userId: string,
  draft: Draft,
) {
  const selectingJobs = draft.items?.some(
    (item) => item.jobDescriptionIds !== undefined || item.skipped !== undefined,
  );
  const jobs = selectingJobs ? await loadEligibleSmartJobs(organizationId, userId) : [];
  await validateDraftPortfolios(draft.items ?? [], organizationId, userId);
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, id, organizationId, userId);
    if (task.submittedAt) {
      throw new Error("任务已经提交。");
    }
    if (draft.recruitmentSource !== undefined || draft.recruitmentSourceDetail !== undefined) {
      await saveTaskSource(tx, id, draft);
    }
    if (draft.items) {
      await saveTaskItemDrafts(tx, id, draft.items, new Set(jobs.map((job) => job.job.id)));
    }
  });
}

export async function submitSmartTask(
  id: string,
  organizationId: string,
  userId: string,
  userRole?: string | null,
) {
  // Resolve current scope before taking the task lock so concurrent requests cannot exhaust the pool.
  const jobs = await loadEligibleSmartJobs(organizationId, userId);
  const records = await db.transaction(async (tx) => {
    const task = await lockTask(tx, id, organizationId, userId);
    const items = await tx
      .select({
        item: smartResumeTaskItem,
        pool: { id: poolIdColumn, ...poolColumns },
        upload: resumeUploadBatchItem,
      })
      .from(smartResumeTaskItem)
      .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
      .leftJoin(resumePoolItem, eq(resumePoolItem.id, resumeUploadBatchItem.poolItemId))
      .where(eq(smartResumeTaskItem.taskId, id));
    if (task.submittedAt) {
      return items.flatMap(({ item }) => item.createdRecordIds);
    }
    const [batch] = await tx.select().from(resumeUploadBatch).where(eq(resumeUploadBatch.id, id));
    if (!batch) {
      throw new Error("上传任务不存在。");
    }
    if (items.some(({ item }) => !item.skipped) && !isSmartResumeTaskSourceComplete(batch)) {
      throw new Error("请选择简历来源并补全来源信息后提交。");
    }
    const created: string[] = [];
    for (const { item, pool, upload } of items) {
      if (
        upload.status === "processing" ||
        upload.status === "pending" ||
        (upload.status === "succeeded" &&
          (item.status === "processing" || item.status === "pending"))
      ) {
        throw new Error("请等待后台处理完成后提交。");
      }
      if (item.skipped) {
        continue;
      }
      if (!pool?.resumeProfile || pool.resumeParseStatus !== "ready") {
        throw new Error("仍有简历解析未完成，请重试或选择本次跳过。");
      }
      if (!item.selectedJobIds.length) {
        throw new Error("请为每份简历选择岗位，或选择本次跳过。");
      }
      const recordIds: string[] = [];
      for (const jobId of item.selectedJobIds) {
        const destination = jobs.find((job) => job.job.id === jobId);
        if (!destination) {
          throw new Error("所选岗位已失效或已超出负责范围，请重新选择。");
        }
        const recordId = await createResumeRecordFromStorage(
          {
            candidateEmail: pool.candidateEmail,
            candidateName: pool.candidateName,
            candidatePhone: pool.candidatePhone,
            contentHash: pool.resumeContentHash,
            hiringUnitId: destination.option.hiringUnitId,
            jobDescriptionId: jobId,
            notes: null,
            organizationId,
            portfolioAttachments: item.portfolioAttachments,
            recruitmentSource: batch.recruitmentSource,
            recruitmentSourceDetail: batch.recruitmentSourceDetail,
            resumeFileName: pool.resumeFileName,
            resumeProfile: pool.resumeProfile,
            resumeText: pool.resumeText,
            source: {
              importedAt: new Date(),
              importedBy: userId,
              poolItemId: pool.id,
              type: "private_pool",
            },
            storageKey: pool.resumeStorageKey,
            targetRole: pool.targetRole,
            userId,
            userRole,
          },
          tx,
        );
        recordIds.push(recordId);
        await tx.insert(resumePoolImport).values({
          id: crypto.randomUUID(),
          importedBy: userId,
          importedResumeRecordId: recordId,
          organizationId,
          poolItemId: pool.id,
        });
        await tx.insert(resumePoolEvent).values({
          actorId: userId,
          id: crypto.randomUUID(),
          organizationId,
          payload: { jobDescriptionId: jobId, resumeRecordId: recordId, smartTaskId: id },
          poolItemId: pool.id,
          type: "imported",
        });
      }
      await tx
        .update(smartResumeTaskItem)
        .set({ createdRecordIds: recordIds })
        .where(eq(smartResumeTaskItem.id, item.id));
      created.push(...recordIds);
    }
    await tx
      .update(smartResumeTask)
      .set({ submittedAt: new Date() })
      .where(eq(smartResumeTask.id, id));
    return created;
  });
  // Existing candidate enrichment remains independent of recommendation generation.
  const candidates = records.length
    ? await db
        .select({ id: studioInterview.id, jobDescriptionId: studioInterview.jobDescriptionId })
        .from(studioInterview)
        .where(
          and(
            eq(studioInterview.organizationId, organizationId),
            inArray(studioInterview.id, records),
          ),
        )
    : [];
  for (const candidate of candidates) {
    await enqueueResumeSemanticIndexJobBestEffort({
      organizationId,
      sourceId: candidate.id,
      sourceType: "studio_interview",
    });
    await enqueueResumeReviewGenerationForRecordBestEffort({
      jobDescriptionId: candidate.jobDescriptionId,
      organizationId,
      resumeRecordId: candidate.id,
      source: "resume_pool_import",
    });
  }
  return { recordIds: records };
}

export async function retrySmartTask(id: string, organizationId: string, userId: string) {
  const payloads = await db.transaction(async (tx) => {
    const task = await lockTask(tx, id, organizationId, userId);
    if (task.submittedAt) {
      throw new Error("任务已经提交。");
    }
    const rows = await tx
      .select({ item: smartResumeTaskItem, upload: resumeUploadBatchItem })
      .from(smartResumeTaskItem)
      .innerJoin(resumeUploadBatchItem, eq(resumeUploadBatchItem.id, smartResumeTaskItem.id))
      .where(eq(smartResumeTaskItem.taskId, id))
      .for("update");
    const retriable = rows.filter(
      ({ item, upload }) =>
        upload.status !== "processing" &&
        (upload.status === "failed" || upload.status === "pending" || item.status !== "ready"),
    );
    if (!retriable.length) {
      return [];
    }
    const itemIds = retriable.map(({ item }) => item.id);
    await tx
      .update(resumeUploadBatchItem)
      .set({ errorMessage: null, finishedAt: null, startedAt: null, status: "pending" })
      .where(inArray(resumeUploadBatchItem.id, itemIds));
    await tx
      .update(smartResumeTaskItem)
      .set({ error: null, status: "pending" })
      .where(inArray(smartResumeTaskItem.id, itemIds));
    await tx
      .update(resumeUploadBatch)
      .set({ completedAt: null, status: "pending" })
      .where(eq(resumeUploadBatch.id, id));
    return itemIds.map((itemId) => ({ batchId: id, itemId, organizationId, userId }));
  });
  const { enqueueResumeParseJobs } = await import("@arc/resume-parse-queue/resume-parse");
  if (payloads.length) {
    await enqueueResumeParseJobs(payloads);
  }
  return { queued: payloads.length };
}
