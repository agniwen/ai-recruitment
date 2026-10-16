ALTER TABLE "platform_mfa_factor" ADD COLUMN "pending_secret" text;
ALTER TABLE "platform_mfa_factor" ADD COLUMN "pending_session_id" text;
ALTER TABLE "platform_mfa_factor" ADD COLUMN "pending_expires_at" timestamptz;

COMMENT ON COLUMN "platform_mfa_factor"."pending_secret" IS 'Encrypted replacement TOTP secret; the active factor is kept until the replacement is verified.';
