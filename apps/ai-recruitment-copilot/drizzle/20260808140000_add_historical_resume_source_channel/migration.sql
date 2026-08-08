ALTER TABLE "resume_pool_item"
  DROP CONSTRAINT IF EXISTS "resume_pool_item_source_channel_check";
--> statement-breakpoint
ALTER TABLE "resume_pool_item"
  ADD CONSTRAINT "resume_pool_item_source_channel_check"
  CHECK (
    "source_channel" IS NULL
    OR "source_channel" IN ('historical_import', 'mail_ingest', 'referral')
  );
