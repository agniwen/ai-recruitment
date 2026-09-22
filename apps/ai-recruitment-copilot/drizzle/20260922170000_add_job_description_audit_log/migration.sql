CREATE TABLE "job_description_audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "job_description_id" text NOT NULL,
  "job_code" text,
  "job_name" text NOT NULL,
  "candidate_id" text,
  "operator_id" text,
  "operator_role" text,
  "action" text NOT NULL,
  "source" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_description_audit_log"
  ADD CONSTRAINT "job_description_audit_log_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "job_description_audit_log"
  ADD CONSTRAINT "job_description_audit_log_operator_id_user_id_fk"
  FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "job_description_audit_log_job_created_idx"
  ON "job_description_audit_log" USING btree ("job_description_id", "created_at");
--> statement-breakpoint
CREATE INDEX "job_description_audit_log_org_created_idx"
  ON "job_description_audit_log" USING btree ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX "job_description_audit_log_candidate_idx"
  ON "job_description_audit_log" USING btree ("candidate_id");
