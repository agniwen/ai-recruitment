ALTER TABLE "job_description" ADD COLUMN IF NOT EXISTS "resume_source_id" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_description_resume_source_org_fk' AND conrelid = 'job_description'::regclass) THEN
    ALTER TABLE "job_description" ADD CONSTRAINT "job_description_resume_source_org_fk"
      FOREIGN KEY ("organization_id", "resume_source_id") REFERENCES "resume_source" ("organization_id", "id") ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_description_resume_source_idx" ON "job_description" ("organization_id", "resume_source_id");
--> statement-breakpoint
-- Reuse maintained sources within the same workspace; create only missing names.
-- Empty historical values remain unassigned. Do not move organizations/departments.
WITH names AS (
  SELECT DISTINCT ON (organization_id, lower(btrim(regexp_replace(normalize(source_sheet, NFKC), '\s+', ' ', 'g'))))
    organization_id, btrim(source_sheet) AS name,
    lower(btrim(regexp_replace(normalize(source_sheet, NFKC), '\s+', ' ', 'g'))) AS identity
  FROM job_description
  WHERE resume_source_id IS NULL AND source_sheet IS NOT NULL AND btrim(source_sheet) <> ''
  ORDER BY organization_id, lower(btrim(regexp_replace(normalize(source_sheet, NFKC), '\s+', ' ', 'g'))), created_at, id
)
INSERT INTO resume_source (id, organization_id, name)
SELECT gen_random_uuid()::text, names.organization_id, names.name FROM names
WHERE NOT EXISTS (
  SELECT 1 FROM resume_source s WHERE s.organization_id = names.organization_id
    AND lower(btrim(regexp_replace(normalize(s.name, NFKC), '\s+', ' ', 'g'))) = names.identity
);
--> statement-breakpoint
WITH matches AS (
  SELECT j.id, s.id AS source_id, s.name
  FROM job_description j
  CROSS JOIN LATERAL (
    SELECT id, name FROM resume_source s
    WHERE s.organization_id = j.organization_id
      AND lower(btrim(regexp_replace(normalize(s.name, NFKC), '\s+', ' ', 'g'))) =
          lower(btrim(regexp_replace(normalize(j.source_sheet, NFKC), '\s+', ' ', 'g')))
    ORDER BY s.created_at, s.id LIMIT 1
  ) s
  WHERE j.resume_source_id IS NULL AND j.source_sheet IS NOT NULL AND btrim(j.source_sheet) <> ''
)
UPDATE job_description j SET resume_source_id = matches.source_id, source_sheet = matches.name
FROM matches WHERE j.id = matches.id;
