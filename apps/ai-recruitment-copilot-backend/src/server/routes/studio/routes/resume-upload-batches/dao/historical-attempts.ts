import { and, eq, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  describeError,
  serializeErrorDetails,
} from "@arc/ai-recruitment-copilot-backend/lib/server/error-reporting";
import {
  resumeUploadBatch,
  resumeUploadBatchItem,
  resumeUploadBatchItemAttempt,
} from "@arc/db-schema/schema";

export async function loadHistoricalImportStorageKey(itemId: string): Promise<string | null> {
  const [row] = await db
    .select({ storageKey: resumeUploadBatchItem.storageKey })
    .from(resumeUploadBatchItem)
    .innerJoin(resumeUploadBatch, eq(resumeUploadBatch.id, resumeUploadBatchItem.batchId))
    .where(
      and(
        eq(resumeUploadBatchItem.id, itemId),
        eq(resumeUploadBatch.sourceChannel, "historical_import"),
      ),
    )
    .limit(1);
  return row?.storageKey ?? null;
}

export async function startHistoricalImportAttempt(input: {
  attemptNumber: number;
  itemId: string;
  step: string;
  workerId: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .update(resumeUploadBatchItem)
      .set({ currentStep: input.step })
      .where(eq(resumeUploadBatchItem.id, input.itemId));
    await tx.insert(resumeUploadBatchItemAttempt).values({
      attemptNumber: input.attemptNumber,
      id,
      itemId: input.itemId,
      status: "processing",
      workerId: input.workerId,
    });
  });
  return id;
}

export async function setHistoricalImportAttemptStep(
  attemptId: string,
  itemId: string,
  step: string,
): Promise<void> {
  await db
    .update(resumeUploadBatchItem)
    .set({ currentStep: step })
    .where(eq(resumeUploadBatchItem.id, itemId));
  await db
    .update(resumeUploadBatchItemAttempt)
    .set({ failedStep: step })
    .where(
      and(
        eq(resumeUploadBatchItemAttempt.id, attemptId),
        eq(resumeUploadBatchItemAttempt.status, "processing"),
      ),
    );
}

export function finishHistoricalImportAttempt(input: {
  attemptId: string;
  error?: unknown;
  failedStep?: string;
  itemId: string;
  status: "failed" | "succeeded";
}): Promise<number> {
  const errorMessage =
    input.error === undefined ? null : describeError(input.error, "历史简历解析失败。");
  const errorDetails = input.error === undefined ? null : serializeErrorDetails(input.error);
  return db.transaction(async (tx) => {
    await tx
      .update(resumeUploadBatchItemAttempt)
      .set({
        endedAt: new Date(),
        errorDetails,
        errorMessage: errorMessage?.slice(0, 2000) ?? null,
        failedStep: input.failedStep ?? null,
        status: input.status,
      })
      .where(eq(resumeUploadBatchItemAttempt.id, input.attemptId));
    const [item] = await tx
      .update(resumeUploadBatchItem)
      .set({
        currentStep: null,
        failureCount:
          input.status === "failed"
            ? sql`${resumeUploadBatchItem.failureCount} + 1`
            : resumeUploadBatchItem.failureCount,
      })
      .where(eq(resumeUploadBatchItem.id, input.itemId))
      .returning({ failureCount: resumeUploadBatchItem.failureCount });
    return item?.failureCount ?? 0;
  });
}
