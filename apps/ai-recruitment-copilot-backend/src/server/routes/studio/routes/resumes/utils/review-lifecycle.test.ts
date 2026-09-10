import { describe, expect, it } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import type { ResumeReview } from "@arc/db-schema/resume-review";
import type { ResumeScreeningResult } from "@arc/shared/resume-screening";
import { runResumeAssessmentLifecycle } from "./review-lifecycle";
import type { ResumeAssessmentLifecycleDeps, ResumeAssessmentRecord } from "./review-lifecycle";

const PROFILE = {
  age: null,
  educationExperiences: [],
  email: null,
  gender: null,
  name: "张三",
  personalStrengths: [],
  phone: null,
  projectExperiences: [],
  schools: [],
  skills: ["TypeScript"],
  targetRoles: ["工程师"],
  workExperiences: [],
  workYears: 3,
} satisfies ResumeProfile;

const OLD_REVIEW = { overall: { conclusion: "上一次成功结果" }, schemaVersion: 4 } as ResumeReview;
const OLD_SCREENING = { recommendation: "flag" } as ResumeScreeningResult;
const NEW_REVIEW = {
  overall: { conclusion: "本次结果" },
  schemaVersion: 5,
  version: 5,
} as ResumeReview;
const NEW_SCREENING = null;

function createStore(overrides: Partial<ResumeAssessmentRecord> = {}) {
  const record: ResumeAssessmentRecord & {
    resumeReviewRunId: string | null;
    resumeReviewError: string | null;
    resumeReviewStatus: string;
    resumeScreeningError: string | null;
    resumeScreeningStatus: string;
  } = {
    jobDescriptionId: "jd-1",
    outcome: "in_pipeline",
    pipelineStage: "screening",
    resumeParseStatus: "ready",
    resumeProfile: PROFILE,
    resumeReview: OLD_REVIEW,
    resumeReviewError: null,
    resumeReviewRunId: null,
    resumeReviewStatus: "ready",
    resumeScreeningError: null,
    resumeScreeningResult: OLD_SCREENING,
    resumeScreeningStatus: "ready",
    resumeText: "简历正文",
    ...overrides,
  };
  const deps: ResumeAssessmentLifecycleDeps = {
    generate: () =>
      Promise.resolve({
        review: "本次结果",
        screeningResult: NEW_SCREENING,
        structuredReview: NEW_REVIEW,
      }),
    loadRecord: () => Promise.resolve(record),
    markExistingReady: ({ expectedJobDescriptionId }) => {
      if (
        record.jobDescriptionId !== expectedJobDescriptionId ||
        record.resumeReviewRunId !== null
      ) {
        return Promise.resolve(false);
      }
      record.resumeReviewError = null;
      record.resumeReviewStatus = "ready";
      record.resumeScreeningError = null;
      record.resumeScreeningStatus = record.resumeScreeningResult ? "ready" : "idle";
      return Promise.resolve(true);
    },
    markFailed: ({ errorMessage, expectedJobDescriptionId, runId }) => {
      if (
        record.jobDescriptionId !== expectedJobDescriptionId ||
        (runId !== undefined && record.resumeReviewRunId !== runId)
      ) {
        return Promise.resolve(false);
      }
      record.resumeReviewError = errorMessage;
      record.resumeReviewRunId = null;
      record.resumeReviewStatus = "failed";
      return Promise.resolve(true);
    },
    markProcessing: ({ expectedJobDescriptionId, runId }) => {
      if (record.jobDescriptionId !== expectedJobDescriptionId) {
        return Promise.resolve(false);
      }
      record.resumeReviewError = null;
      record.resumeReviewRunId = runId;
      record.resumeReviewStatus = "processing";
      return Promise.resolve(true);
    },
    markReady: ({ assessment, expectedJobDescriptionId, runId }) => {
      if (
        record.jobDescriptionId !== expectedJobDescriptionId ||
        record.resumeReviewRunId !== runId
      ) {
        return Promise.resolve(false);
      }
      record.resumeReview = assessment.structuredReview;
      record.resumeReviewError = null;
      record.resumeReviewRunId = null;
      record.resumeReviewStatus = "ready";
      record.resumeScreeningResult = assessment.screeningResult;
      record.resumeScreeningError = null;
      record.resumeScreeningStatus = assessment.screeningResult ? "ready" : "idle";
      return Promise.resolve(true);
    },
  };
  return { deps, record };
}

describe("runResumeAssessmentLifecycle", () => {
  it("does not upgrade an existing legacy review during a normal queued run", async () => {
    const { deps, record } = createStore();
    deps.generate = () => {
      throw new Error("must not regenerate historical results");
    };
    const result = await runResumeAssessmentLifecycle(
      { force: false, organizationId: "org-1", resumeRecordId: "resume-1" },
      deps,
    );
    expect(result).toEqual({ reason: "already_ready", status: "skipped" });
    expect(record.resumeReview).toBe(OLD_REVIEW);
    expect(record.resumeReview).not.toHaveProperty("version");
  });

  it("reassesses screening and review as one ready result", async () => {
    const { deps, record } = createStore();

    const result = await runResumeAssessmentLifecycle(
      {
        expectedJobDescriptionId: "jd-1",
        force: true,
        organizationId: "org-1",
        resumeRecordId: "resume-1",
      },
      deps,
    );

    expect(result).toEqual({ status: "ready" });
    expect(record.resumeReview).toEqual(NEW_REVIEW);
    expect(record.resumeScreeningResult).toEqual(NEW_SCREENING);
    expect(record.resumeReviewStatus).toBe("ready");
    expect(record.resumeScreeningStatus).toBe("idle");
  });

  it("keeps the last successful screening and review when reassessment fails", async () => {
    const { deps, record } = createStore();
    deps.generate = () => Promise.reject(new Error("model unavailable"));

    await expect(
      runResumeAssessmentLifecycle(
        {
          expectedJobDescriptionId: "jd-1",
          force: true,
          organizationId: "org-1",
          resumeRecordId: "resume-1",
        },
        deps,
      ),
    ).rejects.toThrow("model unavailable");

    expect(record.resumeReview).toEqual(OLD_REVIEW);
    expect(record.resumeScreeningResult).toEqual(OLD_SCREENING);
    expect(record.resumeReviewStatus).toBe("failed");
    expect(record.resumeScreeningStatus).toBe("ready");
  });

  it("ignores a stale queued job after the bound job description changed", async () => {
    const { deps, record } = createStore({ jobDescriptionId: "jd-new", resumeReview: null });

    const result = await runResumeAssessmentLifecycle(
      {
        expectedJobDescriptionId: "jd-old",
        force: false,
        organizationId: "org-1",
        resumeRecordId: "resume-1",
      },
      deps,
    );

    expect(result).toEqual({ reason: "stale_job_description", status: "skipped" });
    expect(record.resumeReviewStatus).toBe("ready");
  });

  it("does not let an old queued job reset an active reassessment to ready", async () => {
    const { deps, record } = createStore();
    record.resumeReviewRunId = "active-run";
    record.resumeReviewStatus = "processing";
    record.resumeScreeningStatus = "processing";

    const result = await runResumeAssessmentLifecycle(
      {
        expectedJobDescriptionId: "jd-1",
        force: false,
        organizationId: "org-1",
        resumeRecordId: "resume-1",
      },
      deps,
    );

    expect(result).toEqual({ reason: "stale_job_description", status: "skipped" });
    expect(record.resumeReviewStatus).toBe("processing");
    expect(record.resumeScreeningStatus).toBe("processing");
  });

  it("does not commit an assessment after the bound job description changes mid-run", async () => {
    const { deps, record } = createStore({ resumeReview: null });
    deps.generate = () => {
      record.jobDescriptionId = "jd-new";
      return Promise.resolve({
        review: "本次结果",
        screeningResult: NEW_SCREENING,
        structuredReview: NEW_REVIEW,
      });
    };

    const result = await runResumeAssessmentLifecycle(
      {
        expectedJobDescriptionId: "jd-1",
        force: false,
        organizationId: "org-1",
        resumeRecordId: "resume-1",
      },
      deps,
    );

    expect(result).toEqual({ reason: "superseded", status: "skipped" });
    expect(record.resumeReview).toBeNull();
    expect(record.resumeScreeningResult).toEqual(OLD_SCREENING);
  });
});
