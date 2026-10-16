import { randomBytes, randomUUID } from "node:crypto";
import { encryptIp, ipContext } from "@arc/ai-recruitment-copilot-backend/lib/server/ip-encryption";
import { and, countDistinct, eq, gt, lt } from "drizzle-orm";
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
  studioInterview,
} from "@arc/db-schema/schema";
import { ENTRY_CREDENTIAL_REGISTRATION_LIMIT } from "@arc/shared/entry-credentials";
import type {
  EntryCredentialRegistration,
  EntryCredentialVerification,
} from "@arc/shared/entry-credentials";
import { entryRelyingParty, hashEntrySecret } from "./policy";
import type { CandidateEntryScope } from "./policy";
import { readInterviewTrace, requestEvidence } from "../interview-telemetry/utils";
import { recordServerTelemetrySafely } from "../interview-telemetry/dao";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getRegistrationState(scope: CandidateEntryScope, connection: typeof db | Tx = db) {
  const { rpID } = entryRelyingParty();
  // Successful registrations persist beyond proof expiry; authentication never consumes a slot.
  const [row] = await connection
    .select({ createdCount: countDistinct(uses.credentialRef) })
    .from(uses)
    .innerJoin(credentials, eq(credentials.id, uses.credentialRef))
    .where(
      and(
        eq(uses.organizationId, scope.organizationId),
        eq(uses.candidateId, scope.interviewRecordId),
        eq(uses.meetingId, scope.meetingId),
        eq(uses.method, "register"),
        eq(credentials.rpId, rpID),
      ),
    );
  const { createdCount } = row;
  return {
    canCreate: createdCount < ENTRY_CREDENTIAL_REGISTRATION_LIMIT,
    createdCount,
    limit: ENTRY_CREDENTIAL_REGISTRATION_LIMIT,
  };
}

export class EntryRegistrationLimitError extends Error {
  readonly registration: EntryCredentialRegistration;
  constructor(registration: EntryCredentialRegistration) {
    super("入场凭据已达到创建上限，请使用已有凭据验证，或联系 HR。");
    this.name = "EntryRegistrationLimitError";
    this.registration = registration;
  }
}

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
  const registration = await getRegistrationState(scope);
  if (kind === "register" && !registration.canCreate) {
    throw new EntryRegistrationLimitError(registration);
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
  return { ...generated, challengeId: id, registration };
}

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
    const { aaguid, credential, credentialBackedUp, credentialDeviceType } =
      result.registrationInfo;
    const [saved] = await tx
      .insert(credentials)
      .values({
        aaguid,
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
    if (input.kind === "register") {
      // Serialize creation across tabs/processes before counting and inserting in this transaction.
      const [candidate] = await tx
        .select({ id: studioInterview.id })
        .from(studioInterview)
        .where(
          and(
            eq(studioInterview.id, scope.interviewRecordId),
            eq(studioInterview.organizationId, scope.organizationId),
          ),
        )
        .for("update");
      if (!candidate) {
        throw new Error("Candidate entry scope no longer exists");
      }
      const registration = await getRegistrationState(scope, tx);
      if (!registration.canCreate) {
        throw new EntryRegistrationLimitError(registration);
      }
    }
    const credential = await verifyCredential(tx, input, challenge);
    const evidence = requestEvidence(headers);
    const useId = randomUUID();
    await tx.insert(uses).values({
      browserId: trace.browserId,
      candidateId: scope.interviewRecordId,
      candidateName: scope.candidateName,
      credentialRef: credential.id,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      fingerprintId: trace.fingerprintId,
      id: useId,
      inviteHash: hashEntrySecret(invite),
      ip: await encryptIp(evidence.ip, ipContext("entry-use", scope.organizationId, useId)),
      meetingId: scope.meetingId,
      method: input.kind,
      organizationId: scope.organizationId,
      proofHash: hashEntrySecret(proof),
      properties: { backedUp: credential.backedUp, backupEligible: credential.backupEligible },
      roundId: scope.roundId,
      userAgent: evidence.userAgent,
      visitId: challenge.visitId,
      webauthnResponse: input.response,
    });
    return { credential, registration: await getRegistrationState(scope, tx) };
  });
  await recordCredentialEvent(
    scope,
    headers,
    input.kind === "register" ? "entry_credential_registered" : "entry_credential_verified",
    { credentialRef: saved.credential.id },
  );
  return { credentialRef: saved.credential.id, proof, registration: saved.registration };
}
