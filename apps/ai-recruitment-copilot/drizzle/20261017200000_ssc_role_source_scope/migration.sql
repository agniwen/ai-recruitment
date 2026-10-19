ALTER TABLE "organization_role" ADD COLUMN "is_ssc" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "organization_role_exclusive_business_kind" CHECK (NOT ("is_odc" AND "is_ssc"));
--> statement-breakpoint
ALTER TABLE "ssc_responsibility" ADD COLUMN "workspace_role" text;
--> statement-breakpoint
ALTER TABLE "ssc_responsibility" ADD COLUMN "resume_source_id" text;
--> statement-breakpoint
ALTER TABLE "ssc_responsibility" ADD CONSTRAINT "ssc_responsibility_source_workspace_fk" FOREIGN KEY ("organization_id", "resume_source_id") REFERENCES "public"."resume_source"("organization_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "ssc_responsibility" ADD CONSTRAINT "ssc_responsibility_role_workspace_fk" FOREIGN KEY ("organization_id", "workspace_role") REFERENCES "public"."organization_role"("organization_id", "role") ON DELETE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "ssc_responsibility_workspace_scope_identity_uq" ON "ssc_responsibility" ("organization_id", coalesce('source:' || "resume_source_id", 'name:' || lower(btrim("center_name"))), (CASE WHEN btrim("email") <> '' THEN 'email:' || lower(btrim("email")) WHEN btrim("telegram") <> '' THEN 'telegram:' || lower(btrim("telegram")) WHEN btrim("ssc_name") <> '' THEN 'name:' || lower(btrim("ssc_name")) ELSE 'unassigned' END));
--> statement-breakpoint
DROP INDEX "ssc_responsibility_workspace_center_identity_uq";
--> statement-breakpoint
CREATE INDEX "ssc_responsibility_org_source_idx" ON "ssc_responsibility" ("organization_id", "resume_source_id");
--> statement-breakpoint
CREATE INDEX "ssc_responsibility_role_email_idx" ON "ssc_responsibility" ("organization_id", "workspace_role", lower(btrim("email")));
--> statement-breakpoint
CREATE INDEX "ssc_responsibility_email_idx" ON "ssc_responsibility" (lower(btrim("email")));
