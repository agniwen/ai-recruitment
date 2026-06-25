ALTER TABLE "resume_pool_item"
  ADD COLUMN IF NOT EXISTS "source_channel" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resume_pool_item_source_channel_check'
  ) THEN
    ALTER TABLE "resume_pool_item"
      ADD CONSTRAINT "resume_pool_item_source_channel_check"
      CHECK ("source_channel" IS NULL OR "source_channel" IN ('mail_ingest', 'referral'));
  END IF;
END $$;
