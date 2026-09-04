import type { CompatibleResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";

export type RecruitingCopilotFocusInput = { id: string; kind: "resume_record" } | undefined;

export interface ResolvedRecruitingCopilotFocus {
  id: string;
  kind: "resume_record";
}

interface RecruitingCopilotFocusDeps {
  loadResumeRecord: (input: {
    organizationId: string;
    resumeRecordId: string;
    visibilityScope: CompatibleResumeVisibilityScope;
  }) => Promise<{ id: string } | null>;
}

export async function resolveRecruitingCopilotFocus(
  input: {
    focus: RecruitingCopilotFocusInput;
    organizationId: string;
    visibilityScope: CompatibleResumeVisibilityScope;
  },
  deps: RecruitingCopilotFocusDeps,
): Promise<ResolvedRecruitingCopilotFocus | { kind: "not_found" } | null> {
  if (!input.focus) {
    return null;
  }

  const record = await deps.loadResumeRecord({
    organizationId: input.organizationId,
    resumeRecordId: input.focus.id,
    visibilityScope: input.visibilityScope,
  });
  if (!record) {
    return { kind: "not_found" };
  }

  return {
    id: record.id,
    kind: "resume_record",
  };
}
