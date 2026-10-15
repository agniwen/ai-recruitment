import { describe, expect, it } from "vitest";
import {
  buildResumeSemanticIndexJobId,
  resolveResumeSemanticIndexWorkerConcurrency,
  resumeSemanticIndexJobSchema,
} from "./resume-semantic-index";

describe("resume semantic index queue payload", () => {
  it("validates semantic index jobs", () => {
    expect(
      resumeSemanticIndexJobSchema.parse({
        organizationId: "org-1",
        sourceId: "candidate-1",
        sourceType: "studio_interview",
      }),
    ).toEqual({
      organizationId: "org-1",
      sourceId: "candidate-1",
      sourceType: "studio_interview",
    });
  });

  it("builds stable job ids by source", () => {
    expect(
      buildResumeSemanticIndexJobId({
        sourceId: "candidate:1",
        sourceType: "studio_interview",
      }),
    ).toBe("studio_interview-candidate-1");
  });

  it("defaults semantic concurrency to 50 unless explicitly configured", () => {
    expect(resolveResumeSemanticIndexWorkerConcurrency({})).toBe(50);
    expect(
      resolveResumeSemanticIndexWorkerConcurrency({ RESUME_PARSE_WORKER_CONCURRENCY: "4" }),
    ).toBe(50);
    expect(
      resolveResumeSemanticIndexWorkerConcurrency({
        RESUME_PARSE_WORKER_CONCURRENCY: "4",
        RESUME_SEMANTIC_INDEX_WORKER_CONCURRENCY: "2",
      }),
    ).toBe(2);
  });

  it("accepts job_description sourceType", () => {
    const parsed = resumeSemanticIndexJobSchema.parse({
      organizationId: "org-1",
      sourceId: "jd-1",
      sourceType: "job_description",
    });
    expect(parsed.sourceType).toBe("job_description");
  });
  it("retains manual rebuild intent in durable jobs and gives it a separate deduplication id", () => {
    const job = resumeSemanticIndexJobSchema.parse({
      organizationId: "org",
      rebuildJobMatching: true,
      sourceId: "jd:1",
      sourceType: "job_description",
    });
    expect(job.rebuildJobMatching).toBe(true);
    expect(buildResumeSemanticIndexJobId(job)).toBe("job_description-jd-1-matching-rebuild");
    expect(buildResumeSemanticIndexJobId({ ...job, rebuildJobMatching: false })).toBe(
      "job_description-jd-1",
    );
  });
});
