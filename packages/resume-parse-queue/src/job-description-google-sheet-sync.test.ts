import { describe, expect, it } from "vitest";
import {
  buildJobDescriptionGoogleSheetSyncJobId,
  ensureJobDescriptionGoogleSheetSyncJobEnqueued,
  jobDescriptionGoogleSheetSyncJobSchema,
  resolveJobDescriptionGoogleSheetSyncWorkerConcurrency,
} from "./job-description-google-sheet-sync";

describe("job description Google Sheet sync queue", () => {
  it("uses the persistent sync run id as the idempotent queue job id", () => {
    expect(buildJobDescriptionGoogleSheetSyncJobId({ runId: "run:123" })).toBe("run-123");
  });

  it("validates the minimal worker payload", () => {
    expect(
      jobDescriptionGoogleSheetSyncJobSchema.parse({
        runId: "run-1",
      }),
    ).toEqual({ runId: "run-1" });
  });

  it("runs one organization sync at a time by default", () => {
    expect(resolveJobDescriptionGoogleSheetSyncWorkerConcurrency({})).toBe(1);
    expect(
      resolveJobDescriptionGoogleSheetSyncWorkerConcurrency({
        JOB_DESCRIPTION_GOOGLE_SHEET_SYNC_WORKER_CONCURRENCY: "2",
      }),
    ).toBe(2);
  });

  it("exports ensure-enqueue for DB/Redis recovery paths", () => {
    expect(typeof ensureJobDescriptionGoogleSheetSyncJobEnqueued).toBe("function");
  });
});
