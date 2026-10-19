-- Enroll current, unsent legacy drafts without rewriting historical Offers.
-- Preserve ssc_revision; enrollment does not change the Offer's terms.
DO $$
DECLARE
  candidate_row record;
BEGIN
  -- Use the same candidate-first lock order as Offer mutations and hiring.
  FOR candidate_row IN
    SELECT candidate.id, candidate.organization_id
    FROM studio_interview AS candidate
    WHERE candidate.pipeline_stage = 'offer'
      AND candidate.outcome = 'in_pipeline'
      AND EXISTS (
        SELECT 1
        FROM studio_offer_draft AS draft
        WHERE draft.interview_record_id = candidate.id
          AND draft.organization_id = candidate.organization_id
          AND draft.status = 'draft'
          AND draft.sent_at IS NULL
          AND draft.response_at IS NULL
          AND draft.ssc_confirmation_status IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM studio_offer_draft AS newer
            WHERE newer.interview_record_id = draft.interview_record_id
              AND newer.organization_id = draft.organization_id
              AND newer.version > draft.version
          )
      )
    ORDER BY candidate.organization_id, candidate.id
    FOR UPDATE OF candidate
  LOOP
    -- Recheck after the lock: a concurrent send, closure or new version may
    -- have finished while this migration was waiting for the candidate.
    UPDATE studio_offer_draft AS draft
    SET ssc_confirmation_status = 'pending',
        ssc_received_by = NULL,
        ssc_received_at = NULL,
        ssc_completed_by = NULL,
        ssc_completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE draft.interview_record_id = candidate_row.id
      AND draft.organization_id = candidate_row.organization_id
      AND draft.status = 'draft'
      AND draft.sent_at IS NULL
      AND draft.response_at IS NULL
      AND draft.ssc_confirmation_status IS NULL
      AND EXISTS (
        SELECT 1
        FROM studio_interview AS candidate
        WHERE candidate.id = candidate_row.id
          AND candidate.organization_id = candidate_row.organization_id
          AND candidate.pipeline_stage = 'offer'
          AND candidate.outcome = 'in_pipeline'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM studio_offer_draft AS newer
        WHERE newer.interview_record_id = draft.interview_record_id
          AND newer.organization_id = draft.organization_id
          AND newer.version > draft.version
      );
  END LOOP;
END $$;
