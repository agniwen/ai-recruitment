import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { candidateEntryCredentialUse, studioInterview } from "@arc/db-schema/schema";
import type { resolveHumanInterviewMeetingInviteToken } from "../../../studio/routes/interviews/dao/human-interview-meetings";
import { readInterviewTrace } from "../interview-telemetry/utils";

export type CandidateEntryScope = NonNullable<
  Awaited<ReturnType<typeof resolveHumanInterviewMeetingInviteToken>>
>;
export const hashEntrySecret = (value: string) => createHash("sha256").update(value).digest("hex");

export async function getCandidateEntryPolicy(
  scope: Pick<CandidateEntryScope, "organizationId" | "interviewRecordId">,
) {
  const [row] = await db
    .select({
      enabled: studioInterview.entryCredentialEnabled,
    })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, scope.interviewRecordId),
        eq(studioInterview.organizationId, scope.organizationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error("Candidate entry scope no longer exists");
  }
  return { required: row.enabled };
}

export async function checkCandidateEntryProof(
  scope: CandidateEntryScope,
  inviteToken: string,
  headers: Headers,
) {
  const policy = await getCandidateEntryPolicy(scope);
  if (!policy.required) {
    return { allowed: true, credentialRef: null };
  }
  const proof = headers.get("x-interview-entry-proof");
  const { visitId } = readInterviewTrace(headers);
  if (!proof || proof.length > 200 || !visitId) {
    return { allowed: false, credentialRef: null };
  }
  const [use] = await db
    .select({ credentialRef: candidateEntryCredentialUse.credentialRef })
    .from(candidateEntryCredentialUse)
    .where(
      and(
        eq(candidateEntryCredentialUse.proofHash, hashEntrySecret(proof)),
        eq(candidateEntryCredentialUse.inviteHash, hashEntrySecret(inviteToken)),
        eq(candidateEntryCredentialUse.organizationId, scope.organizationId),
        eq(candidateEntryCredentialUse.candidateId, scope.interviewRecordId),
        eq(candidateEntryCredentialUse.meetingId, scope.meetingId),
        eq(candidateEntryCredentialUse.roundId, scope.roundId),
        eq(candidateEntryCredentialUse.visitId, visitId),
        gt(candidateEntryCredentialUse.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return { allowed: Boolean(use), credentialRef: use?.credentialRef ?? null };
}

export function entryRelyingParty() {
  // Never derive the expected origin from untrusted Host / Origin / forwarded headers.
  const configured =
    process.env.INTERVIEW_ENTRY_CREDENTIAL_ORIGIN || process.env.NEXT_PUBLIC_BASE_URL;
  if (!configured) {
    throw new Error("Entry credential origin is not configured");
  }
  const url = new URL(configured);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  ) {
    throw new Error("Entry credentials require HTTPS");
  }
  return { origin: url.origin, rpID: url.hostname };
}
