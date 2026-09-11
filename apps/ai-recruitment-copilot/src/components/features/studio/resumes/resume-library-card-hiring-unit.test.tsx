import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_RESUME_PROFILE_SNAPSHOT } from "@arc/shared/studio-resumes";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import { ResumeLibraryCard } from "./resume-library-card";
import type { ResumeLibraryCardProps } from "./resume-library-card.types";

vi.mock("./resume-library-card-actions", () => ({ ResumeLibraryCardActions: () => null }));
vi.mock("@/components/features/studio/job-descriptions/job-description-hover-card", () => ({
  JobDescriptionHoverCard: () => null,
}));
vi.mock("@/components/features/resume/copyable-resume-record-id", () => ({
  CopyableResumeRecordId: () => null,
}));
vi.mock("@/components/features/display/time-display", () => ({ TimeDisplay: () => null }));

describe("candidate card hiring unit", () => {
  it.each([
    ["岗位组织", "入库组织", "岗位组织"],
    [null, "入库组织", "入库组织"],
    [undefined, "入库组织", "入库组织"],
    [null, null, "未分配用人组织"],
  ])(
    "prefers the job unit and falls back when absent (%s, %s)",
    (jobDescriptionHiringUnitName, hiringUnitName, expected) => {
      const record: ResumeLibraryListRecord = {
        candidateEmail: null,
        candidateName: "候选人",
        candidatePhone: null,
        closedReason: null,
        createdAt: "2026-09-11T00:00:00Z",
        createdBy: null,
        creatorImage: null,
        creatorName: null,
        duplicateMatch: null,
        hasInterviewRounds: false,
        hasResumeFile: false,
        hiringUnitId: null,
        hiringUnitName,
        hrResumeAssessment: null,
        hrResumeAssessmentUpdatedAt: null,
        hrResumeAssessmentUpdatedBy: null,
        humanInterviewScheduledAt: null,
        humanInterviewerId: null,
        humanInterviewers: [],
        id: "candidate-1",
        jobDescriptionAiInterviewDisabled: false,
        jobDescriptionDepartmentName: null,
        jobDescriptionHiringUnitName: jobDescriptionHiringUnitName ?? null,
        jobDescriptionId: "job-1",
        jobDescriptionInterviewers: [],
        jobDescriptionName: null,
        lastInterviewAt: null,
        notes: null,
        outcome: "in_pipeline",
        pipelineStage: "ai_review",
        recommendationText: null,
        recruitmentSource: null,
        recruitmentSourceDetail: null,
        resumeContentHash: null,
        resumeEvaluationStatus: null,
        resumeEvaluatorId: null,
        resumeEvaluatorImage: null,
        resumeEvaluatorName: null,
        resumeFileName: null,
        resumeParseRetryable: false,
        resumeParseStatus: "ready",
        resumeProfileSnapshot: EMPTY_RESUME_PROFILE_SNAPSHOT,
        resumeReviewBaseScore: null,
        resumeReviewNextStepAction: null,
        resumeReviewStatus: "idle",
        resumeScreeningError: null,
        resumeScreeningEvaluatedAt: null,
        resumeScreeningResult: null,
        resumeScreeningStale: false,
        resumeScreeningStatus: "idle",
        resumeSkills: [],
        resumeSummary: null,
        stageProgress: { aiInterview: null, humanInterview: null, offer: null },
        targetRole: null,
        updatedAt: "2026-09-11T00:00:00Z",
      };
      const markup = renderToStaticMarkup(
        <ResumeLibraryCard
          {...({ currentMemberRole: "admin", record } as ResumeLibraryCardProps)}
        />,
      );
      expect(markup).toContain(`用人组织：${expected}`);
      if (jobDescriptionHiringUnitName) {
        expect(markup).not.toContain("用人组织：入库组织");
      }
    },
  );
});
