import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Evidence is retained independently of candidate/meeting deletion, like interview telemetry.
export const candidateEntryCredential = pgTable(
  "candidate_entry_credential",
  {
    aaguid: text("aaguid"),
    backedUp: boolean("backed_up").notNull(),
    backupEligible: boolean("backup_eligible").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    credentialId: text("credential_id").notNull(),
    id: text("id").primaryKey(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    publicKey: text("public_key").notNull(),
    rpId: text("rp_id").notNull(),
    userHandle: text("user_handle").notNull(),
  },
  (table) => [
    uniqueIndex("candidate_entry_credential_rp_key_idx").on(table.rpId, table.credentialId),
  ],
);

export const candidateEntryChallenge = pgTable(
  "candidate_entry_challenge",
  {
    candidateId: text("candidate_id").notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    id: text("id").primaryKey(),
    inviteHash: text("invite_hash").notNull(),
    kind: text("kind").notNull(),
    meetingId: text("meeting_id").notNull(),
    organizationId: text("organization_id").notNull(),
    roundId: text("round_id").notNull(),
    userHandle: text("user_handle"),
    visitId: text("visit_id").notNull(),
  },
  (table) => [
    index("candidate_entry_challenge_expiry_idx").on(table.expiresAt),
    index("candidate_entry_challenge_visit_idx").on(table.inviteHash, table.visitId),
  ],
);

export const candidateEntryCredentialUse = pgTable(
  "candidate_entry_credential_use",
  {
    browserId: text("browser_id"),
    candidateId: text("candidate_id").notNull(),
    candidateName: text("candidate_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    credentialRef: text("credential_ref").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    fingerprintId: text("fingerprint_id"),
    id: text("id").primaryKey(),
    inviteHash: text("invite_hash").notNull(),
    ip: text("ip"),
    meetingId: text("meeting_id").notNull(),
    method: text("method").notNull(),
    organizationId: text("organization_id").notNull(),
    proofHash: text("proof_hash").notNull(),
    properties: jsonb("properties")
      .$type<{ backupEligible: boolean; backedUp: boolean }>()
      .notNull(),
    roundId: text("round_id").notNull(),
    userAgent: text("user_agent"),
    visitId: text("visit_id").notNull(),
    webauthnResponse: jsonb("webauthn_response").$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex("candidate_entry_use_proof_idx").on(table.proofHash),
    index("candidate_entry_use_meeting_idx").on(table.meetingId),
    index("candidate_entry_use_credential_idx").on(table.credentialRef, table.organizationId),
  ],
);
