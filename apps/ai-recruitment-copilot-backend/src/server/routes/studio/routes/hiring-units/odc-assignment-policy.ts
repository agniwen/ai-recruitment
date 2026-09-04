export interface OdcAssignmentIdentity {
  memberIds: string[];
  organizationId: string;
}

export interface OdcCandidateIdentity {
  isOdc: boolean;
  memberId: string;
  organizationId: string;
}

export function canAssignOdcMembers(
  assignment: OdcAssignmentIdentity,
  candidates: OdcCandidateIdentity[],
) {
  const eligibleMemberIds = new Set(
    candidates
      .filter(
        (candidate) => candidate.isOdc && candidate.organizationId === assignment.organizationId,
      )
      .map((candidate) => candidate.memberId),
  );
  return assignment.memberIds.every((memberId) => eligibleMemberIds.has(memberId));
}
