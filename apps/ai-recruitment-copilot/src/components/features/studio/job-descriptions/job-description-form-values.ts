import type { JobDescriptionFormValues } from "@arc/shared/job-descriptions";
import { createDefaultResumeScreeningPolicy } from "@arc/shared/job-descriptions";

const DEFAULT_AI_INTERVIEW_DISABLED = true;

export interface AiGeneratedJobDescriptionDraft {
  departmentId: string;
  description: string;
  name: string;
  prompt: string;
}

export function createJobDescriptionFormValues(): JobDescriptionFormValues {
  return {
    aiInterviewDisabled: DEFAULT_AI_INTERVIEW_DISABLED,
    allowCrossDepartmentInterviewers: false,
    code: "",
    departmentId: "",
    description: "",
    humanInterviewerIds: [],
    interviewerIds: [],
    name: "",
    priority: "P0",
    prompt: "",
    requester: "",
    resumeContact: "",
    resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
    workEndTime: "",
    workStartTime: "",
    workTimezone: "",
  };
}

export function createAiGeneratedJobDescriptionFormValues(
  draft: AiGeneratedJobDescriptionDraft,
): JobDescriptionFormValues {
  return {
    aiInterviewDisabled: DEFAULT_AI_INTERVIEW_DISABLED,
    allowCrossDepartmentInterviewers: false,
    controlCategory: null,
    departmentId: draft.departmentId,
    description: draft.description,
    expectedOnboardDate: null,
    gapCount: null,
    headcount: null,
    humanInterviewerIds: [],
    interviewerIds: [],
    jobLevel: null,
    jobSeries: null,
    name: draft.name,
    notes: null,
    offeredPendingOnboardCount: null,
    onboardedCount: null,
    priority: "P0",
    prompt: draft.prompt,
    recruitmentStatus: null,
    requestedDate: null,
    requester: null,
    resumeContact: null,
    resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
    salaryCurrency: null,
    salaryMaxAmount: null,
    salaryMinAmount: null,
    serviceUnit: null,
    sourceSheet: null,
    workEndTime: null,
    workLocation: null,
    workStartTime: null,
    workTimezone: null,
  };
}
