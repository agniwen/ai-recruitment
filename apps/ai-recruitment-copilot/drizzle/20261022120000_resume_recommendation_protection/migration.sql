ALTER TABLE global_config ADD COLUMN resume_protection_days integer NOT NULL DEFAULT 15;
ALTER TABLE global_config ADD COLUMN resume_protection_updated_at timestamptz;
ALTER TABLE global_config ADD COLUMN resume_protection_updated_by text;
ALTER TABLE global_config ADD CONSTRAINT global_config_resume_protection_days_check CHECK (resume_protection_days BETWEEN 1 AND 365);

ALTER TABLE studio_interview ADD COLUMN resume_admission_checked_at timestamptz;
ALTER TABLE studio_interview ADD COLUMN resume_admission_status text NOT NULL DEFAULT 'accepted';
ALTER TABLE studio_interview ADD COLUMN resume_protection jsonb;
ALTER TABLE studio_interview ADD COLUMN resume_protection_cycle_id text;
-- Pre-deployment upload placeholders are not historical valid recommendations.
UPDATE studio_interview SET resume_admission_status = 'pending',
  resume_review = NULL, resume_review_status = 'idle', resume_screening_result = NULL,
  resume_evaluation_status = NULL
WHERE resume_profile IS NULL AND resume_parse_status <> 'ready'
  AND pipeline_stage = 'ai_review';
ALTER TABLE studio_interview ADD CONSTRAINT studio_interview_admission_status_check CHECK (resume_admission_status IN ('accepted', 'pending', 'protected'));
ALTER TABLE studio_interview ADD CONSTRAINT studio_interview_admission_workflow_check CHECK (
  resume_admission_status = 'accepted' OR (
    pipeline_stage IN ('ai_review', 'closed') AND outcome <> 'hired'
    AND resume_review IS NULL AND resume_screening_result IS NULL
    AND resume_evaluation_status IS NULL AND resume_review_status = 'idle'
  )
);
CREATE INDEX studio_interview_org_admission_stage_idx ON studio_interview (organization_id, resume_admission_status, pipeline_stage);

CREATE TABLE resume_protection_cycle (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  owner_name text NOT NULL,
  identity jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  duration_days integer NOT NULL,
  CONSTRAINT resume_protection_cycle_duration_days_check CHECK (duration_days BETWEEN 1 AND 365),
  CONSTRAINT resume_protection_cycle_time_check CHECK (expires_at > starts_at)
);
CREATE INDEX resume_protection_cycle_workspace_expiry_idx ON resume_protection_cycle (organization_id, expires_at);
CREATE INDEX resume_protection_cycle_identity_hash_idx ON resume_protection_cycle (organization_id, (identity->>'contentHash'));
CREATE INDEX resume_protection_cycle_identity_email_idx ON resume_protection_cycle (organization_id, (identity->>'email'));
CREATE INDEX resume_protection_cycle_identity_phone_idx ON resume_protection_cycle (organization_id, (identity->>'phone'));

CREATE TABLE resume_protection_recommendation (
  record_id text PRIMARY KEY,
  identity jsonb NOT NULL,
  cycle_id text NOT NULL REFERENCES resume_protection_cycle(id) ON DELETE CASCADE,
  hiring_unit_name text,
  target_role text,
  recommended_at timestamptz NOT NULL
);
CREATE INDEX resume_protection_recommendation_cycle_idx ON resume_protection_recommendation (cycle_id);

CREATE TABLE resume_protection_config_change (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  previous_days integer NOT NULL,
  days integer NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Guard every round/offer writer, including legacy and background entry points.
CREATE FUNCTION require_resume_recommendation_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM studio_interview
    WHERE id = NEW.interview_record_id AND organization_id = NEW.organization_id
      AND resume_admission_status = 'accepted'
  ) THEN
    RAISE EXCEPTION '该候选人暂不能继续推荐，请查看保护详情。' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER studio_interview_schedule_resume_admission BEFORE INSERT OR UPDATE ON studio_interview_schedule FOR EACH ROW EXECUTE FUNCTION require_resume_recommendation_admission();
CREATE TRIGGER studio_human_interview_round_resume_admission BEFORE INSERT OR UPDATE ON studio_human_interview_round FOR EACH ROW EXECUTE FUNCTION require_resume_recommendation_admission();
CREATE TRIGGER studio_offer_draft_resume_admission BEFORE INSERT OR UPDATE ON studio_offer_draft FOR EACH ROW EXECUTE FUNCTION require_resume_recommendation_admission();

-- Existing rows remain accepted. Protection cycles are not fabricated from
-- upload or reparse timestamps. Verified historical recommendations are imported
-- separately with their real recommendation dates before enabling the feature.
