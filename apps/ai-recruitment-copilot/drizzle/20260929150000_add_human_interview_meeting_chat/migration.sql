CREATE TABLE "studio_human_interview_meeting_chat_message" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_id" text NOT NULL REFERENCES "studio_human_interview_meeting"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "participant_identity" text NOT NULL,
  "sender_name" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "studio_human_meeting_chat_content_check" CHECK (length(trim("content")) > 0 AND length("content") <= 2000)
);
--> statement-breakpoint
CREATE INDEX "studio_human_meeting_chat_meeting_idx" ON "studio_human_interview_meeting_chat_message" ("meeting_id", "created_at");
