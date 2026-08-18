ALTER TABLE "studio_interview"
  ADD COLUMN IF NOT EXISTS "actual_onboarded_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "created_by_role" text,
  ADD COLUMN IF NOT EXISTS "onboarded_confirmed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "onboarded_confirmed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "onboarded_confirmed_by_role" text;

ALTER TABLE "studio_interview_schedule"
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancel_reason" text,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "created_by_role" text;

ALTER TABLE "studio_human_interview_round"
  ADD COLUMN IF NOT EXISTS "completed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "completed_by_role" text,
  ADD COLUMN IF NOT EXISTS "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "created_by_role" text,
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;

ALTER TABLE "studio_offer_draft"
  ADD COLUMN IF NOT EXISTS "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "created_by_role" text,
  ADD COLUMN IF NOT EXISTS "sent_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "sent_by_role" text;

ALTER TABLE "interview_audit_log"
  ADD COLUMN IF NOT EXISTS "operator_role" text,
  ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;

UPDATE "studio_interview_schedule"
SET "completed_at" = "updated_at"
WHERE "status" = 'completed' AND "completed_at" IS NULL;

UPDATE "studio_interview"
SET "actual_onboarded_at" = CASE
  WHEN COALESCE("closed_meta"->'hiredDetails'->>'joiningDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
    THEN (("closed_meta"->'hiredDetails'->>'joiningDate') || 'T00:00:00+08:00')::timestamptz
  ELSE "closed_at"
END
WHERE "outcome" = 'hired' AND "actual_onboarded_at" IS NULL;

CREATE INDEX IF NOT EXISTS "studio_interview_org_outcome_onboarded_at_idx"
  ON "studio_interview" ("organization_id", "outcome", "actual_onboarded_at");

CREATE INDEX IF NOT EXISTS "studio_interview_schedule_org_scheduled_status_record_idx"
  ON "studio_interview_schedule" ("organization_id", "scheduled_at", "status", "interview_record_id");

CREATE INDEX IF NOT EXISTS "studio_human_interview_round_org_scheduled_status_idx"
  ON "studio_human_interview_round" ("organization_id", "scheduled_at", "status");

CREATE INDEX IF NOT EXISTS "studio_offer_draft_org_record_sent_idx"
  ON "studio_offer_draft" ("organization_id", "interview_record_id", "sent_at");

CREATE INDEX IF NOT EXISTS "studio_offer_draft_org_joining_status_idx"
  ON "studio_offer_draft" ("organization_id", "joining_date", "status");

CREATE INDEX IF NOT EXISTS "interview_audit_log_org_action_created_at_idx"
  ON "interview_audit_log" ("organization_id", "action", "created_at");
