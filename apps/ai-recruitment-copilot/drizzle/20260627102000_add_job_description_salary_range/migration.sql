ALTER TABLE "job_description"
  ADD COLUMN IF NOT EXISTS "salary_min_amount" integer,
  ADD COLUMN IF NOT EXISTS "salary_max_amount" integer,
  ADD COLUMN IF NOT EXISTS "salary_currency" text;
