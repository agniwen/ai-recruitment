import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  candidateEntryChallenge as challenges,
  candidateEntryCredential as credentials,
  candidateEntryCredentialUse as uses,
} from "@arc/db-schema/schema";
import type { EntryCredentialVerification } from "@arc/shared/entry-credentials";
import { entryRelyingParty, hashEntrySecret } from "./policy";
import type { CandidateEntryScope } from "./policy";
import { readInterviewTrace, requestEvidence } from "../interview-telemetry/utils";
import { recordServerTelemetrySafely } from "../interview-telemetry/dao";

export function recordCredentialEvent(
  scope: CandidateEntryScope,
  headers: Headers,
  type: string,
  details: Record<string, unknown> = {},
) {
  return recordServerTelemetrySafely({
    details,
    headers,
    participantIdentity: `candidate_${scope.roundId}`,
    participantName: scope.candidateName,
    participantRole: "candidate",
    roomName: scope.liveKitRoomName,
    type,
  });
}

export async function createEntryOptions(
  scope: CandidateEntryScope,
  invite: string,
  headers: Headers,
  kind: "register" | "authenticate",
) {
  const { rpID } = entryRelyingParty();
  const { visitId } = readInterviewTrace(headers);
  if (!visitId) {
    throw new Error("Missing visit");
  }
  const userHandle = randomBytes(32).toString("base64url");
  const generated =
    kind === "register"
      ? {
          kind: "register" as const,
          options: {
            ...(await generateRegistrationOptions({
              attestationType: "none",
              authenticatorSelection: {
                authenticatorAttachment: "platform",
                residentKey: "required",
                userVerification: "required",
              },
              rpID,
              rpName: "面试入场凭据",
              timeout: 60_000,
              userID: new Uint8Array(Buffer.from(userHandle, "base64url")),
              userName: `入场凭据 ${randomUUID().slice(0, 8)}`,
            })),
            extensions: { credProps: true },
            hints: ["client-device" as const],
          },
        }
      : {
          kind: "authenticate" as const,
          options: {
            ...(await generateAuthenticationOptions({
              rpID,
              timeout: 60_000,
              userVerification: "required",
            })),
            extensions: undefined,
            hints: ["client-device" as const],
          },
        };
  const id = randomUUID();
  // Challenges are ephemeral. Reissuing for this visit invalidates its previous challenge.
  await db.delete(challenges).where(lt(challenges.expiresAt, new Date()));
  await db
    .delete(challenges)
    .where(
      and(eq(challenges.inviteHash, hashEntrySecret(invite)), eq(challenges.visitId, visitId)),
    );
  await db.insert(challenges).values({
    candidateId: scope.interviewRecordId,
    challenge: generated.options.challenge,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    id,
    inviteHash: hashEntrySecret(invite),
    kind,
    meetingId: scope.meetingId,
    organizationId: scope.organizationId,
    roundId: scope.roundId,
    userHandle: kind === "register" ? userHandle : null,
    visitId,
  });
  await recordCredentialEvent(scope, headers, "entry_credential_requested", { method: kind });
  return { ...generated, challengeId: id };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function verifyCredential(
  tx: Tx,
  input: EntryCredentialVerification,
  challenge: typeof challenges.$inferSelect,
) {
  const { origin, rpID } = entryRelyingParty();
  const expectations = {
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  };
  if (input.kind === "register") {
    const result = await verifyRegistrationResponse({ ...expectations, response: input.response });
    if (!result.verified || !challenge.userHandle) {
      throw new Error("Invalid registration");
    }
    const { credential, credentialBackedUp, credentialDeviceType } = result.registrationInfo;
    const [saved] = await tx
      .insert(credentials)
      .values({
        backedUp: credentialBackedUp,
        backupEligible: credentialDeviceType === "multiDevice",
        counter: credential.counter,
        credentialId: credential.id,
        id: `K-${randomUUID()}`,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        rpId: rpID,
        userHandle: challenge.userHandle,
      })
      .returning();
    return saved;
  }
  const [existing] = await tx
    .select()
    .from(credentials)
    .where(and(eq(credentials.rpId, rpID), eq(credentials.credentialId, input.response.id)))
    .for("update");
  if (!existing || input.response.response.userHandle !== existing.userHandle) {
    throw new Error("Unknown credential");
  }
  const result = await verifyAuthenticationResponse({
    ...expectations,
    credential: {
      counter: existing.counter,
      id: existing.credentialId,
      publicKey: new Uint8Array(Buffer.from(existing.publicKey, "base64url")),
    },
    response: input.response,
  });
  if (
    !result.verified ||
    existing.backupEligible !== (result.authenticationInfo.credentialDeviceType === "multiDevice")
  ) {
    throw new Error("Invalid assertion");
  }
  const [saved] = await tx
    .update(credentials)
    .set({
      backedUp: result.authenticationInfo.credentialBackedUp,
      counter: result.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(credentials.id, existing.id))
    .returning();
  return saved;
}

export async function verifyEntryCredential(
  scope: CandidateEntryScope,
  invite: string,
  headers: Headers,
  input: EntryCredentialVerification,
) {
  const trace = readInterviewTrace(headers);
  if (!trace.visitId) {
    throw new Error("Missing visit");
  }
  // Consume before verification, outside its transaction: failed attempts cannot replay it either.
  const [challenge] = await db
    .delete(challenges)
    .where(
      and(
        eq(challenges.id, input.challengeId),
        eq(challenges.kind, input.kind),
        eq(challenges.inviteHash, hashEntrySecret(invite)),
        eq(challenges.visitId, trace.visitId),
        eq(challenges.organizationId, scope.organizationId),
        eq(challenges.candidateId, scope.interviewRecordId),
        eq(challenges.meetingId, scope.meetingId),
        eq(challenges.roundId, scope.roundId),
        gt(challenges.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!challenge) {
    throw new Error("Challenge expired or used");
  }
  const proof = randomBytes(32).toString("base64url");
  const saved = await db.transaction(async (tx) => {
    const credential = await verifyCredential(tx, input, challenge);
    const evidence = requestEvidence(headers);
    await tx.insert(uses).values({
      browserId: trace.browserId,
      candidateId: scope.interviewRecordId,
      candidateName: scope.candidateName,
      credentialRef: credential.id,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      fingerprintId: trace.fingerprintId,
      id: randomUUID(),
      inviteHash: hashEntrySecret(invite),
      ip: evidence.ip,
      meetingId: scope.meetingId,
      method: input.kind,
      organizationId: scope.organizationId,
      proofHash: hashEntrySecret(proof),
      properties: { backedUp: credential.backedUp, backupEligible: credential.backupEligible },
      roundId: scope.roundId,
      userAgent: evidence.userAgent,
      visitId: challenge.visitId,
    });
    return credential;
  });
  await recordCredentialEvent(
    scope,
    headers,
    input.kind === "register" ? "entry_credential_registered" : "entry_credential_verified",
    { credentialRef: saved.id },
  );
  return { credentialRef: saved.id, proof };
}
