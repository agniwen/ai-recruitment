ALTER TABLE "studio_interview" ADD COLUMN "ai_review_assigned_odc_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Recover the recipient of the latest approval, rather than a prior approval.
-- Missing/deleted recipients remain null and do not grant ODC access.
WITH latest_approval AS (
  SELECT DISTINCT ON (organization_id, interview_record_id)
    organization_id, interview_record_id, detail->>'notificationUserId' AS user_id
  FROM interview_audit_log
  WHERE action = 'candidate_transition'
    AND detail->>'fromStage' = 'ai_review'
    AND detail->>'toStage' = 'screening'
  ORDER BY organization_id, interview_record_id, created_at DESC, id DESC
)
UPDATE studio_interview AS candidate
SET ai_review_assigned_odc_user_id = approval.user_id
FROM latest_approval AS approval
JOIN "user" AS recipient ON recipient.id = approval.user_id
WHERE candidate.id = approval.interview_record_id
  AND candidate.organization_id = approval.organization_id
  AND candidate.ai_review_approval_status = 'approved';
