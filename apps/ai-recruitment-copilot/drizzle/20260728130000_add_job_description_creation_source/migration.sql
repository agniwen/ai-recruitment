ALTER TABLE "job_description"
ADD COLUMN "creation_source" text DEFAULT 'manual' NOT NULL;

ALTER TABLE "job_description"
ADD CONSTRAINT "job_description_creation_source_check"
CHECK ("creation_source" IN ('manual', 'google_sheets'));
