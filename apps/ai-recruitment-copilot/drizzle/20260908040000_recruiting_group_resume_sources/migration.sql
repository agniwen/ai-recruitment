-- Existing hiring-unit links are retained, but never converted into source grants.
CREATE UNIQUE INDEX "recruiting_group_org_id_uq" ON "recruiting_group" ("organization_id", "id");
CREATE TABLE "recruiting_group_resume_source" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "group_id" text NOT NULL REFERENCES "recruiting_group"("id") ON DELETE CASCADE,
  "resume_source_id" text NOT NULL REFERENCES "resume_source"("id") ON DELETE CASCADE,
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  CONSTRAINT "recruiting_group_resume_source_group_org_fk" FOREIGN KEY ("organization_id", "group_id") REFERENCES "recruiting_group"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recruiting_group_resume_source_source_org_fk" FOREIGN KEY ("organization_id", "resume_source_id") REFERENCES "resume_source"("organization_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "recruiting_group_resume_source_uq" ON "recruiting_group_resume_source" ("organization_id", "group_id", "resume_source_id");
CREATE INDEX "recruiting_group_resume_source_group_idx" ON "recruiting_group_resume_source" ("organization_id", "group_id");
CREATE INDEX "recruiting_group_resume_source_source_idx" ON "recruiting_group_resume_source" ("organization_id", "resume_source_id");
