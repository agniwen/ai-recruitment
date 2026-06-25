ALTER TABLE "studio_interview" ADD COLUMN IF NOT EXISTS "resume_text" text;
--> statement-breakpoint
ALTER TABLE "resume_pool_item" ADD COLUMN IF NOT EXISTS "resume_text" text;
