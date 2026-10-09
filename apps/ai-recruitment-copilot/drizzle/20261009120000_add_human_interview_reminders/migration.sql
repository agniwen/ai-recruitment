CREATE TABLE "studio_human_interview_reminder_delivery" (
  "round_id" text NOT NULL REFERENCES "studio_human_interview_round" ("id") ON DELETE CASCADE,
  "scheduled_at" timestamptz NOT NULL,
  "recipient_key" text NOT NULL,
  "chat_id" text,
  "roles" jsonb NOT NULL,
  "status" text NOT NULL,
  "attempt_id" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_attempt_at" timestamptz NOT NULL,
  "sent_at" timestamptz,
  "error_code" text,
  PRIMARY KEY ("round_id", "scheduled_at", "recipient_key")
);
COMMENT ON TABLE "studio_human_interview_reminder_delivery" IS '真人面试前十分钟 TG 提醒；按轮次、排期和收件人去重，保存发送结果与重试状态';
