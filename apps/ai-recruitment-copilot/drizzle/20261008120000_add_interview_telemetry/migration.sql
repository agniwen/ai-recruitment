CREATE TABLE "interview_telemetry_event" (
  "id" text PRIMARY KEY,
  "event_key" text NOT NULL,
  "client_sequence" integer,
  "meeting_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "meeting_title" text NOT NULL,
  "room_name" text,
  "participant_identity" text NOT NULL DEFAULT '',
  "participant_name" text,
  "participant_role" text,
  "source" text NOT NULL,
  "type" text NOT NULL,
  "visit_id" text,
  "tab_id" text,
  "attempt_id" text,
  "room_sid" text,
  "participant_sid" text,
  "ip" text,
  "ip_source" text,
  "user_agent" text,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX "interview_telemetry_event_dedupe_idx" ON "interview_telemetry_event" ("meeting_id", "participant_identity", "source", "event_key");
CREATE INDEX "interview_telemetry_event_meeting_time_idx" ON "interview_telemetry_event" ("meeting_id", "received_at", "id");
CREATE INDEX "interview_telemetry_event_received_idx" ON "interview_telemetry_event" ("received_at");
CREATE INDEX "interview_telemetry_event_attempt_idx" ON "interview_telemetry_event" ("attempt_id");
CREATE INDEX "interview_telemetry_event_participant_idx" ON "interview_telemetry_event" ("participant_sid");
COMMENT ON TABLE "interview_telemetry_event" IS '真人面试追加式事件与质量采样；保留会议快照以供删除后排查；按接收时间清理';
CREATE INDEX "interview_telemetry_event_visit_idx" ON "interview_telemetry_event" ("meeting_id", "visit_id", "participant_identity");
CREATE INDEX "interview_telemetry_event_room_idx" ON "interview_telemetry_event" ("room_name");
