ALTER TABLE "job_description"
ADD COLUMN IF NOT EXISTS "hiring_unit_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_description_hiring_unit_id_hiring_unit_id_fk'
  ) THEN
    ALTER TABLE "job_description"
    ADD CONSTRAINT "job_description_hiring_unit_id_hiring_unit_id_fk"
    FOREIGN KEY ("hiring_unit_id") REFERENCES "public"."hiring_unit"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "job_description_hiring_unit_idx"
ON "job_description" USING btree ("organization_id", "hiring_unit_id");

-- Backfill from department.hiring_unit_id for legacy rows.
UPDATE "job_description" AS jd
SET "hiring_unit_id" = d."hiring_unit_id"
FROM "department" AS d
WHERE jd."department_id" = d."id"
  AND jd."hiring_unit_id" IS NULL
  AND d."hiring_unit_id" IS NOT NULL;
