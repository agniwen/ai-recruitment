ALTER TABLE "resume_upload_batch"
  ADD COLUMN IF NOT EXISTS "created_by_role" text;
