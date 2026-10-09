CREATE TABLE studio_human_interview_reminder_schedule (
  meeting_id text PRIMARY KEY,
  organization_id text NOT NULL,
  revision integer NOT NULL,
  scheduled_at timestamptz,
  active boolean NOT NULL,
  queued_revision integer,
  next_sync_at timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX human_reminder_schedule_sync_idx
  ON studio_human_interview_reminder_schedule(next_sync_at) WHERE next_sync_at IS NOT NULL;

CREATE TABLE studio_human_interview_meeting_reminder_delivery (
  meeting_id text NOT NULL,
  revision integer NOT NULL,
  recipient_key text NOT NULL,
  round_ids jsonb NOT NULL,
  scheduled_at timestamptz NOT NULL,
  chat_id text,
  roles jsonb NOT NULL,
  status text NOT NULL,
  attempt_id text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL,
  sent_at timestamptz,
  error_code text,
  PRIMARY KEY (meeting_id, revision, recipient_key)
);
-- No FK to the meeting: cancellation/deletion must not erase delivery evidence.
-- Keep the old round-based delivery table intact for historical inspection.

CREATE FUNCTION sync_human_interview_reminder_schedule() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_id text;
  target_org text;
  target_time timestamptz;
  target_active boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.id;
    target_org := OLD.organization_id;
    target_time := OLD.scheduled_at;
    target_active := false;
  ELSE
    target_id := NEW.id;
    target_org := NEW.organization_id;
    target_time := NEW.scheduled_at;
    target_active := NEW.scheduled_at IS NOT NULL AND NEW.status IN ('scheduled', 'in_progress');
    -- Early room entry is not a new schedule. Metadata edits also keep the version.
    IF TG_OP = 'UPDATE' AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
       AND (NEW.status IN ('scheduled', 'in_progress')) = (OLD.status IN ('scheduled', 'in_progress')) THEN
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO studio_human_interview_reminder_schedule
    (meeting_id, organization_id, revision, scheduled_at, active, next_sync_at)
  VALUES (target_id, target_org, 1, target_time, target_active, now())
  ON CONFLICT (meeting_id) DO UPDATE SET
    revision = studio_human_interview_reminder_schedule.revision + 1,
    scheduled_at = EXCLUDED.scheduled_at, active = EXCLUDED.active,
    next_sync_at = now(), error_code = NULL, updated_at = now();
  -- Delivered only after COMMIT. The durable row is authoritative if NOTIFY is missed.
  PERFORM pg_notify('human_interview_reminder_changed', target_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER human_interview_reminder_schedule_changed
AFTER INSERT OR UPDATE OF scheduled_at, status OR DELETE ON studio_human_interview_meeting
FOR EACH ROW EXECUTE FUNCTION sync_human_interview_reminder_schedule();

-- One-time bootstrap of existing future meetings; never infer a meeting from a leftover round.
INSERT INTO studio_human_interview_reminder_schedule
  (meeting_id, organization_id, revision, scheduled_at, active, next_sync_at)
SELECT id, organization_id, 1, scheduled_at, true, now()
FROM studio_human_interview_meeting
WHERE scheduled_at > now() AND status IN ('scheduled', 'in_progress');

-- Preserve already successful sends when upgrading the previous implementation.
INSERT INTO studio_human_interview_meeting_reminder_delivery
  (meeting_id, revision, recipient_key, round_ids, scheduled_at, chat_id, roles,
   status, attempts, last_attempt_at, sent_at)
SELECT s.meeting_id, s.revision, d.recipient_key, jsonb_agg(DISTINCT d.round_id),
  s.scheduled_at, max(d.chat_id), '[]'::jsonb, 'sent', max(d.attempts),
  max(d.last_attempt_at), max(d.sent_at)
FROM studio_human_interview_reminder_schedule s
JOIN studio_human_interview_meeting_round mr ON mr.meeting_id = s.meeting_id
JOIN studio_human_interview_reminder_delivery d ON d.round_id = mr.round_id
  AND d.scheduled_at = s.scheduled_at AND d.status = 'sent'
GROUP BY s.meeting_id, s.revision, d.recipient_key, s.scheduled_at;
