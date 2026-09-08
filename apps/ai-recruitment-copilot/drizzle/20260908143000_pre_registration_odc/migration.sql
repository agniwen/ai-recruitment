ALTER TABLE "platform_pre_registration"
  ADD COLUMN IF NOT EXISTS "odc_assignments" jsonb DEFAULT '[]'::jsonb NOT NULL;
