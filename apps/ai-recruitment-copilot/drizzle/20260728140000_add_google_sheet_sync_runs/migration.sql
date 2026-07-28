CREATE TABLE "job_description_google_sheet_sync_run" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "requested_by" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "result" jsonb,
  "error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "job_description_google_sheet_sync_run_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "job_description_google_sheet_sync_run_requested_by_user_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "job_description_google_sheet_sync_run_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'))
);

CREATE UNIQUE INDEX "job_description_google_sheet_sync_run_active_org_uq"
ON "job_description_google_sheet_sync_run" USING btree ("organization_id")
WHERE "status" IN ('queued', 'running');

CREATE INDEX "job_description_google_sheet_sync_run_org_created_idx"
ON "job_description_google_sheet_sync_run" USING btree ("organization_id", "created_at");
