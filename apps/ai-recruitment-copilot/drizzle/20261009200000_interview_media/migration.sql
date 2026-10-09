CREATE TABLE interview_media_room (
 room_sid text PRIMARY KEY, room_name text NOT NULL, meeting_id text NOT NULL,
 meeting_title text NOT NULL, organization_id text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz, status text NOT NULL DEFAULT 'waiting', error_code text,
 lease_owner text, lease_until timestamptz, heartbeat_at timestamptz
);
CREATE INDEX interview_media_room_meeting_idx ON interview_media_room(meeting_id, started_at);
CREATE INDEX interview_media_room_started_idx ON interview_media_room(started_at);
CREATE TABLE interview_media_asset (
 id text PRIMARY KEY, meeting_id text NOT NULL, room_sid text NOT NULL, participant_sid text NOT NULL,
 participant_identity text NOT NULL, participant_name text NOT NULL, participant_role text NOT NULL,
 track_sid text, kind text NOT NULL, slot text NOT NULL, status text NOT NULL, captured_at timestamptz NOT NULL,
 duration_ms integer, byte_size integer, content_type text, storage_key text, storage_backend text,
 sha256 text, error_code text, environment jsonb NOT NULL DEFAULT '{}', deleted_at timestamptz, deleted_by text
);
CREATE INDEX interview_media_asset_meeting_time_idx ON interview_media_asset(meeting_id, captured_at);
CREATE INDEX interview_media_asset_pending_idx ON interview_media_asset(captured_at) WHERE status = 'pending';
CREATE UNIQUE INDEX interview_media_asset_slot_idx ON interview_media_asset(room_sid, participant_sid, kind, slot);
CREATE TABLE interview_media_access (
 id text PRIMARY KEY, asset_id text NOT NULL, actor_id text NOT NULL, action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_media_access_asset_idx ON interview_media_access(asset_id, created_at);
