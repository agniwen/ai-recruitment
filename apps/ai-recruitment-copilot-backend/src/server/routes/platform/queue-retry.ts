import { isResumeParseQueueConfigured } from "@arc/resume-parse-queue/resume-parse";
import { retryUploadItem } from "../studio/routes/resume-upload-batches/utils/retry-upload-item";
import { listResumeParseQueueJobsWithDetailFilters } from "./queue-details";
import type {
  PlatformQueueJobRecord,
  ResumeQueueJobsWithDetailFiltersQuery,
} from "./queue-details";

export async function retryFailedParseJobs(input: {
  filters?: Omit<ResumeQueueJobsWithDetailFiltersQuery, "page" | "pageSize">;
  jobIds?: string[];
  requestedBy: string;
}) {
  if (!isResumeParseQueueConfigured()) {
    return { status: "queue_unavailable" as const };
  }
  // Snapshot every page before re-enqueueing changes the filtered result set.
  const records: PlatformQueueJobRecord[] = [];
  if (input.jobIds) {
    for (const id of new Set(input.jobIds)) {
      const result = await listResumeParseQueueJobsWithDetailFilters({
        page: 1,
        pageSize: 100,
        search: id,
        state: "all",
      });
      records.push(...result.records);
    }
  } else {
    let page = 1;
    let totalPages = 1;
    do {
      const result = await listResumeParseQueueJobsWithDetailFilters({
        ...input.filters,
        page,
        pageSize: 100,
        state: input.filters?.state ?? "all",
      });
      records.push(...result.records);
      ({ totalPages } = result);
      page += 1;
    } while (page <= totalPages);
  }
  const jobs = [...new Map(records.map((job) => [job.id, job])).values()];
  const result = { failed: 0, queued: 0, skipped: 0, total: 0 };
  for (const job of jobs) {
    const detail = job.resumeDetail;
    if (
      !detail ||
      detail.itemStatus !== "failed" ||
      (job.state !== "failed" && job.state !== "completed")
    ) {
      continue;
    }
    result.total += 1;
    try {
      const retry = await retryUploadItem({
        itemId: detail.itemId,
        requestedBy: input.requestedBy,
      });
      if (retry.status === "queued") {
        result.queued += 1;
      } else if (retry.status === "queue_unavailable") {
        result.failed += 1;
      } else {
        result.skipped += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return { ...result, status: "done" as const };
}
