ALTER TABLE "resume_upload_batch"
  ADD COLUMN IF NOT EXISTS "source_channel" text;

ALTER TABLE "resume_upload_batch_item"
  ADD COLUMN IF NOT EXISTS "source_folder" text,
  ADD COLUMN IF NOT EXISTS "current_step" text,
  ADD COLUMN IF NOT EXISTS "failure_count" integer DEFAULT 0 NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "resume_upload_batch_item_historical_source_uq"
  ON "resume_upload_batch_item" ("organization_id", "storage_key")
  WHERE "source_folder" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "resume_upload_batch_item_attempt" (
  "id" text PRIMARY KEY NOT NULL,
  "item_id" text NOT NULL REFERENCES "resume_upload_batch_item"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "status" text NOT NULL,
  "worker_id" text,
  "failed_step" text,
  "error_message" text,
  "error_details" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "resume_upload_batch_item_attempt_number_uq"
  ON "resume_upload_batch_item_attempt" ("item_id", "attempt_number");

CREATE INDEX IF NOT EXISTS "resume_upload_batch_item_attempt_status_idx"
  ON "resume_upload_batch_item_attempt" ("status", "started_at");
