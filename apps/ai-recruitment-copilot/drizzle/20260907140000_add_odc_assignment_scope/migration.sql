ALTER TABLE "hiring_unit_odc_member"
ADD COLUMN "job_series" text,
ADD COLUMN "service_unit" text;

ALTER TABLE "department_odc_member"
ADD COLUMN "job_series" text,
ADD COLUMN "service_unit" text;

ALTER TABLE "hiring_unit_odc_member"
ADD CONSTRAINT "hiring_unit_odc_member_job_series_check"
CHECK ("job_series" IS NULL OR "job_series" IN ('直属', '派驻'));

ALTER TABLE "department_odc_member"
ADD CONSTRAINT "department_odc_member_job_series_check"
CHECK ("job_series" IS NULL OR "job_series" IN ('直属', '派驻'));
