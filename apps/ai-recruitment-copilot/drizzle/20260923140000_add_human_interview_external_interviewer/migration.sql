CREATE TABLE "studio_human_interview_external_interviewer" (
  "id" text PRIMARY KEY,
  "round_id" text NOT NULL REFERENCES "studio_human_interview_round"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "telegram" text NOT NULL,
  "joined_at" timestamptz,
  "left_at" timestamptz
);
CREATE INDEX "human_interview_external_round_idx" ON "studio_human_interview_external_interviewer" ("round_id");
