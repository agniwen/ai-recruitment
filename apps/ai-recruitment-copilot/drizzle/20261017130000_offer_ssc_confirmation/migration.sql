ALTER TABLE studio_offer_draft
  ADD COLUMN ssc_confirmation_status text,
  ADD COLUMN ssc_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN ssc_received_by text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN ssc_received_at timestamptz,
  ADD COLUMN ssc_completed_by text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN ssc_completed_at timestamptz,
  ADD CONSTRAINT studio_offer_draft_ssc_status_check
    CHECK (ssc_confirmation_status IS NULL OR ssc_confirmation_status IN ('pending', 'confirming', 'completed')),
  ADD CONSTRAINT studio_offer_draft_ssc_revision_check CHECK (ssc_revision > 0);
