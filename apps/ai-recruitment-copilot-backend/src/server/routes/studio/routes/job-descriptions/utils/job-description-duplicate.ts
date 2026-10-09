import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { jobDescription } from "@arc/db-schema/schema";
import type { JobDescriptionFormValues } from "@arc/shared/job-descriptions";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DuplicateFields = Pick<
  JobDescriptionFormValues,
  "name" | "departmentId" | "serviceUnit" | "sourceSheet" | "requester" | "resumeContact"
>;

export class DuplicateJobDescriptionError extends Error {
  constructor() {
    super(
      "已存在岗位、部门、服务单位、来源表格、需求发起人和简历对接人均相同的记录。是否仍要保存？",
    );
    this.name = "DuplicateJobDescriptionError";
  }
}

// Use the same lock order as Google sync (workspace lock, then row locks).
// This serializes saves against bulk sync and concurrent creates, not reads or other workspaces.
export async function lockJobDescriptionDuplicateCheck(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-sheets-job-sync:${organizationId}`}, 0))`,
  );
}

export async function getJobDescriptionDuplicateSnapshot(
  tx: Tx,
  input: DuplicateFields,
  organizationId: string,
  excludeId?: string,
) {
  const nullableFields = ["serviceUnit", "sourceSheet", "requester", "resumeContact"] as const;
  const matches = await tx
    .select({ id: jobDescription.id })
    .from(jobDescription)
    .where(
      and(
        eq(jobDescription.organizationId, organizationId),
        eq(jobDescription.departmentId, input.departmentId),
        sql`btrim(${jobDescription.name}) = ${input.name.trim()}`,
        excludeId ? ne(jobDescription.id, excludeId) : undefined,
        ...nullableFields.map(
          (field) =>
            sql`coalesce(btrim(${jobDescription[field]}), '') = ${input[field]?.trim() || ""}`,
        ),
      ),
    )
    .limit(1);
  // Neither inactive nor Google-deleted entries are omitted: they still exist in management.
  return { duplicateAtSave: matches.length > 0, duplicateCheckedAt: new Date() };
}
