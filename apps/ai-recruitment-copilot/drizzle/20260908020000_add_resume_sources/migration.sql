-- New organizational level only. Existing assignments are intentionally not migrated.
CREATE TABLE "resume_source" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "description" text,
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "resume_source_name_idx" ON "resume_source" ("name");
CREATE INDEX "resume_source_created_at_idx" ON "resume_source" ("created_at");
CREATE INDEX "resume_source_organization_idx" ON "resume_source" ("organization_id");
CREATE UNIQUE INDEX "resume_source_organization_id_id_uq" ON "resume_source" ("organization_id", "id");

ALTER TABLE "hiring_unit" ADD COLUMN "resume_source_id" text REFERENCES "resume_source"("id") ON DELETE RESTRICT;
ALTER TABLE "hiring_unit" ADD CONSTRAINT "hiring_unit_resume_source_fk"
  FOREIGN KEY ("organization_id", "resume_source_id") REFERENCES "resume_source"("organization_id", "id") ON DELETE RESTRICT;
CREATE INDEX "hiring_unit_resume_source_idx" ON "hiring_unit" ("organization_id", "resume_source_id");

CREATE TABLE "resume_source_odc_member" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resume_source_id" text NOT NULL REFERENCES "resume_source"("id") ON DELETE CASCADE,
  "job_series" text,
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "service_unit" text,
  PRIMARY KEY ("resume_source_id", "member_id"),
  CONSTRAINT "resume_source_odc_member_job_series_check" CHECK ("job_series" IS NULL OR "job_series" IN ('直属', '派驻')),
  CONSTRAINT "resume_source_odc_member_resume_source_fk" FOREIGN KEY ("organization_id", "resume_source_id") REFERENCES "resume_source"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "resume_source_odc_member_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "member"("organization_id", "id") ON DELETE CASCADE
);
CREATE INDEX "resume_source_odc_member_organization_idx" ON "resume_source_odc_member" ("organization_id");
CREATE INDEX "resume_source_odc_member_member_idx" ON "resume_source_odc_member" ("organization_id", "member_id");
