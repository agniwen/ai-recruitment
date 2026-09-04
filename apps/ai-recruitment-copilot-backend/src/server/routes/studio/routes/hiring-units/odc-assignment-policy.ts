export interface OdcAssignmentIdentity {
  memberId: string;
  organizationId: string;
}

export interface OdcCandidateIdentity extends OdcAssignmentIdentity {
  isOdc: boolean;
}

export function canAssignOdcMember(
  assignment: OdcAssignmentIdentity,
  candidate: OdcCandidateIdentity,
) {
  return (
    candidate.isOdc &&
    candidate.memberId === assignment.memberId &&
    candidate.organizationId === assignment.organizationId
  );
}
