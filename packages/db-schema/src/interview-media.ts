import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export interface InterviewMediaEnvironment {
  attemptId?: string;
  visitId?: string;
  tabId?: string;
  browserId?: string;
  fingerprint?: string;
  fingerprintVersion?: string;
  ip?: string;
  ipSource?: string;
  userAgent?: string;
}

// Independent archives intentionally survive meeting deletion and telemetry retention.
export const interviewMediaRoom = pgTable(
  "interview_media_room",
  {
    endedAt: timestamp("ended_at", { withTimezone: true }),
    errorCode: text("error_code"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    meetingId: text("meeting_id").notNull(),
    meetingTitle: text("meeting_title").notNull(),
    organizationId: text("organization_id").notNull(),
    roomName: text("room_name").notNull(),
    roomSid: text("room_sid").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    status: text("status")
      .$type<"waiting" | "capturing" | "stopped" | "error">()
      .default("waiting")
      .notNull(),
  },
  (t) => [
    index("interview_media_room_meeting_idx").on(t.meetingId, t.startedAt),
    index("interview_media_room_started_idx").on(t.startedAt),
  ],
);

export const interviewMediaAsset = pgTable(
  "interview_media_asset",
  {
    byteSize: integer("byte_size"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    contentType: text("content_type"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    durationMs: integer("duration_ms"),
    environment: jsonb("environment").$type<InterviewMediaEnvironment>().default({}).notNull(),
    errorCode: text("error_code"),
    id: text("id").primaryKey(),
    kind: text("kind").$type<"image" | "audio">().notNull(),
    meetingId: text("meeting_id").notNull(),
    participantIdentity: text("participant_identity").notNull(),
    participantName: text("participant_name").notNull(),
    participantRole: text("participant_role").notNull(),
    participantSid: text("participant_sid").notNull(),
    roomSid: text("room_sid").notNull(),
    sha256: text("sha256"),
    slot: text("slot").notNull(),
    status: text("status")
      .$type<"pending" | "ready" | "failed" | "skipped" | "deleted">()
      .notNull(),
    storageBackend: text("storage_backend").$type<"local" | "r2">(),
    storageKey: text("storage_key"),
    trackSid: text("track_sid"),
  },
  (t) => [
    index("interview_media_asset_meeting_time_idx").on(t.meetingId, t.capturedAt),
    index("interview_media_asset_pending_idx")
      .on(t.capturedAt)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex("interview_media_asset_slot_idx").on(t.roomSid, t.participantSid, t.kind, t.slot),
  ],
);

export const interviewMediaAccess = pgTable(
  "interview_media_access",
  {
    action: text("action").$type<"view" | "delete">().notNull(),
    actorId: text("actor_id").notNull(),
    assetId: text("asset_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: text("id").primaryKey(),
  },
  (t) => [index("interview_media_access_asset_idx").on(t.assetId, t.createdAt)],
);
