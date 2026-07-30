CREATE INDEX IF NOT EXISTS "job_description_org_source_sheet_idx"
ON "job_description" USING btree ("organization_id", "source_sheet")
WHERE "source_sheet" IS NOT NULL;
