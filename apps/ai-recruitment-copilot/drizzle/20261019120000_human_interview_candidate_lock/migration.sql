CREATE TABLE "platform_interview_config" (
  "id" text PRIMARY KEY,
  "human_interview_lock_hours" integer DEFAULT 48 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "platform_interview_config_singleton" CHECK ("id" = 'singleton'),
  CONSTRAINT "platform_interview_config_lock_hours" CHECK ("human_interview_lock_hours" BETWEEN 1 AND 8760)
);

INSERT INTO "platform_interview_config" ("id") VALUES ('singleton');

-- Preserve the original 48-hour policy for rounds created before this feature.
ALTER TABLE "studio_human_interview_round" ADD COLUMN "lock_hours" integer DEFAULT 48 NOT NULL;
