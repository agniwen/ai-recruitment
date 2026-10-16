ALTER TABLE "session" ADD COLUMN "ip_ciphertext" text;
ALTER TABLE "interview_telemetry_event" ADD COLUMN "ip_lookup_hash" text;
CREATE INDEX "interview_telemetry_event_ip_lookup_idx" ON "interview_telemetry_event" ("ip_lookup_hash");

CREATE TABLE "platform_mfa_factor" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "secret" text NOT NULL,
  "verified_at" timestamptz,
  "enrollment_session_id" text,
  "enrollment_expires_at" timestamptz,
  "last_used_step" integer NOT NULL DEFAULT -1,
  "recovery_code_hashes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "failed_attempts" integer NOT NULL DEFAULT 0,
  "failure_window_at" timestamptz,
  "locked_until" timestamptz
);
CREATE TABLE "platform_mfa_grant" (
  "session_id" text PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL
);
CREATE TABLE "platform_security_audit" (
  "id" text PRIMARY KEY,
  "actor_id" text NOT NULL,
  "session_id" text,
  "action" text NOT NULL,
  "target_id" text,
  "organization_id" text,
  "outcome" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "platform_security_audit_actor_time_idx" ON "platform_security_audit" ("actor_id", "created_at");

COMMENT ON COLUMN "session"."ip_ciphertext" IS 'RSA-OAEP-256 + A256GCM JWE; never included in auth responses. Run security:backfill-ips to clear legacy ip_address.';
COMMENT ON COLUMN "interview_telemetry_event"."ip" IS 'Versioned IP ciphertext. Legacy plaintext requires security:backfill-ips before reopening traffic.';
COMMENT ON COLUMN "candidate_entry_credential_use"."ip" IS 'Versioned IP ciphertext; plaintext is never returned by normal read APIs.';
