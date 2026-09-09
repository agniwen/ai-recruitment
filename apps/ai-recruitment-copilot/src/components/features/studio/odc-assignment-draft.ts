import type { OdcAssignmentItem, OdcJobSeries } from "@arc/shared/hiring-units";

export interface OdcAssignmentDraft {
  canApproveAiReview?: boolean;
  jobSeries: OdcJobSeries | null;
  memberId: string;
  serviceUnit: string;
}

export function selectOdcAssignmentDrafts(
  current: OdcAssignmentDraft[],
  memberIds: string[],
): OdcAssignmentDraft[] {
  return memberIds.map(
    (memberId) =>
      current.find((assignment) => assignment.memberId === memberId) ?? {
        jobSeries: null,
        memberId,
        serviceUnit: "",
      },
  );
}

export function serializeOdcAssignmentDrafts(
  assignments: OdcAssignmentDraft[],
): OdcAssignmentItem[] {
  return assignments.map((assignment) => ({
    ...assignment,
    serviceUnit: assignment.serviceUnit.trim() || null,
  }));
}
