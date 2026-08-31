ALTER TABLE "job_description" ADD COLUMN "created_by_role" text;
--> statement-breakpoint
ALTER TABLE "job_description_google_sheet_sync_run" ADD COLUMN "requested_by_role" text;
--> statement-breakpoint
UPDATE "job_description"
SET "created_by_role" = "member"."role"
FROM "member"
WHERE "member"."organization_id" = "job_description"."organization_id"
  AND "member"."user_id" = "job_description"."created_by";
--> statement-breakpoint
UPDATE "job_description_google_sheet_sync_run"
SET "requested_by_role" = "member"."role"
FROM "member"
WHERE "member"."organization_id" = "job_description_google_sheet_sync_run"."organization_id"
  AND "member"."user_id" = "job_description_google_sheet_sync_run"."requested_by";
