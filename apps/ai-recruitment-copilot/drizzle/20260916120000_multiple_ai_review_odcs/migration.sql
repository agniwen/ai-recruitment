CREATE TABLE "studio_interview_odc_assignment" (
  "interview_record_id" text NOT NULL REFERENCES "studio_interview"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  PRIMARY KEY ("interview_record_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "studio_interview_odc_assignment_user_idx" ON "studio_interview_odc_assignment" ("user_id");
--> statement-breakpoint
-- Keep the legacy column and its data while old and new application versions coexist.
-- Old approvals/re-activations still write that column. Clear stale multi-assignments
-- on those writes (including re-approval to the same user); new code replaces them
-- within the same transaction after updating studio_interview.
CREATE FUNCTION "clear_legacy_ai_review_odc_assignments"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "studio_interview_odc_assignment"
  WHERE "interview_record_id" = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "studio_interview_legacy_odc_assignment_changed"
AFTER UPDATE OF "ai_review_assigned_odc_user_id" ON "studio_interview"
FOR EACH ROW
-- ON DELETE SET NULL for a deleted primary user must preserve the other assignees.
WHEN (NEW.ai_review_assigned_odc_user_id IS NOT NULL OR NEW.ai_review_approval_status <> 'approved')
EXECUTE FUNCTION "clear_legacy_ai_review_odc_assignments"();
