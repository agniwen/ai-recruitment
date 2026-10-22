ALTER TABLE "ssc_responsibility" ADD COLUMN "service_unit" text;
--> statement-breakpoint
ALTER TABLE "ssc_responsibility" ADD COLUMN "department_id" text;
--> statement-breakpoint
ALTER TABLE "ssc_responsibility" ADD CONSTRAINT "ssc_responsibility_department_workspace_fk" FOREIGN KEY ("organization_id", "department_id") REFERENCES "department" ("organization_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
DROP INDEX "ssc_responsibility_workspace_scope_identity_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "ssc_responsibility_workspace_scope_identity_uq" ON "ssc_responsibility" (
  "organization_id",
  coalesce('source:' || "resume_source_id", 'name:' || lower(btrim("center_name"))),
  (CASE
    WHEN btrim("email") <> '' THEN 'email:' || lower(btrim("email"))
    WHEN btrim("telegram") <> '' THEN 'telegram:' || lower(btrim("telegram"))
    WHEN btrim("ssc_name") <> '' THEN 'name:' || lower(btrim("ssc_name"))
    ELSE 'unassigned'
  END),
  lower(btrim(coalesce("service_unit", ''))),
  coalesce("department_id", '')
);
