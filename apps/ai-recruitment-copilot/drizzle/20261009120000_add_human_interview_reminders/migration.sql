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

-- 中文表注释与字段说明，便于直接查询数据库时理解记录含义。
COMMENT ON TABLE "public"."studio_human_interview_reminder_delivery" IS '旧版按轮次发送的真人面试前十分钟 TG 提醒记录；保留历史查询和升级迁移，当前会议级提醒不再向本表写入';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."round_id" IS '关联真人面试轮次 ID；旧版外键随轮次删除级联清除';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."scheduled_at" IS '该次提醒对应的轮次预约时间快照；与轮次 ID、收件人键共同去重';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."recipient_key" IS '收件人去重键；已绑定时为 chat:聊天ID，未绑定时保留人员标识';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."chat_id" IS 'Telegram 私聊目标 chat ID；尚未绑定时为空';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."roles" IS '收件人通知角色快照 JSON 数组，如招聘人员、面试官、分配 ODC；同一人可兼任多个角色';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."status" IS '发送状态：sending 发送中、sent 已发送、failed 失败、unbound 未绑定 TG、skipped 已跳过';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."attempt_id" IS '本次领取发送任务的尝试 ID，用于避免过期尝试覆盖新发送结果';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."attempts" IS '已领取的发送尝试次数，初始为 0';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."created_at" IS '发送记录首次创建时间';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."last_attempt_at" IS '最近一次发送尝试或状态记录时间，用于失败重试与发送超时恢复';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."sent_at" IS '成功发送到 Telegram 的时间，未成功时为空';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_delivery"."error_code" IS '发送失败、未绑定或跳过的原因代码，正常时为空';
