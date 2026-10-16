import type {
  CandidateOutcome,
  PipelineStage,
  ResumeEvaluationStatus,
} from "@arc/db-schema/studio-interviews";

export interface ResumeDuplicateRecruitmentContext {
  hiringUnitName?: string | null;
  resumeSourceName?: string | null;
  departmentName?: string | null;
  pipelineStage?: PipelineStage | null;
  outcome?: CandidateOutcome | null;
  resumeEvaluationStatus?: ResumeEvaluationStatus | null;
}

export type ResumeDuplicateMatchLevel = "high" | "low" | "medium";

export interface ResumeDuplicateMatchSummary {
  count: number;
  highestLevel: ResumeDuplicateMatchLevel | null;
}
