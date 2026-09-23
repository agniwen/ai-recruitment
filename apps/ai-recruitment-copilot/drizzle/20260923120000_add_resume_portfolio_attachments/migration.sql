ALTER TABLE "studio_interview" ADD COLUMN IF NOT EXISTS "portfolio_attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;
