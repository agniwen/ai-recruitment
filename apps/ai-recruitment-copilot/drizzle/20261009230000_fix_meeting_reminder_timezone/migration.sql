-- 历史会议预约时间以 UTC 写入无时区字段；显式按 UTC 转换，保持实际预约时刻不变。
-- 已使用 timestamptz 的数据库跳过类型转换，避免重复偏移。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'studio_human_interview_meeting'
      AND column_name = 'scheduled_at' AND data_type = 'timestamp without time zone'
  ) THEN
    -- UPDATE OF scheduled_at 触发器依赖字段类型，须在同一事务中先移除再重建。
    DROP TRIGGER human_interview_reminder_schedule_changed ON "public"."studio_human_interview_meeting";
    ALTER TABLE "public"."studio_human_interview_meeting"
      ALTER COLUMN "scheduled_at" TYPE timestamptz USING "scheduled_at" AT TIME ZONE 'UTC';
    CREATE TRIGGER human_interview_reminder_schedule_changed
      AFTER INSERT OR UPDATE OF scheduled_at, status OR DELETE ON "public"."studio_human_interview_meeting"
      FOR EACH ROW EXECUTE FUNCTION sync_human_interview_reminder_schedule();
  END IF;
END $$;

COMMENT ON COLUMN "public"."studio_human_interview_meeting"."scheduled_at" IS '会议预约开始时刻，使用带时区时间；历史无时区值按 UTC 转换，界面按北京时间显示，提醒在此前十分钟执行';
COMMENT ON TRIGGER "human_interview_reminder_schedule_changed" ON "public"."studio_human_interview_meeting" IS '会议新增、预约时间或状态更新、删除后同步 TG 提醒调度记录；普通资料修改与提前入会不重复创建排期版本';

-- 仅修复与会议实际时间不一致的排期；递增版本使旧队列任务失效。
-- 保留 queued_revision，Worker 可据此清理旧任务；保留已有成功发送证据，避免重复通知。
DO $$
DECLARE corrected record;
BEGIN
  FOR corrected IN
    UPDATE studio_human_interview_reminder_schedule s
    SET scheduled_at = m.scheduled_at, revision = s.revision + 1,
        active = m.scheduled_at IS NOT NULL AND m.status IN ('scheduled', 'in_progress'),
        next_sync_at = now(), error_code = NULL, updated_at = now()
    FROM studio_human_interview_meeting m
    WHERE m.id = s.meeting_id AND s.scheduled_at IS DISTINCT FROM m.scheduled_at
    RETURNING s.meeting_id, s.revision, s.scheduled_at
  LOOP
    INSERT INTO studio_human_interview_meeting_reminder_delivery
      (meeting_id, revision, recipient_key, round_ids, scheduled_at, chat_id, roles,
       status, attempt_id, attempts, created_at, last_attempt_at, sent_at, error_code)
    SELECT d.meeting_id, corrected.revision, d.recipient_key, d.round_ids,
           corrected.scheduled_at, d.chat_id, d.roles, d.status, d.attempt_id,
           d.attempts, d.created_at, d.last_attempt_at, d.sent_at, d.error_code
    FROM studio_human_interview_meeting_reminder_delivery d
    WHERE d.meeting_id = corrected.meeting_id AND d.revision = corrected.revision - 1
      AND d.status = 'sent' AND corrected.scheduled_at IS NOT NULL
    ON CONFLICT DO NOTHING;
    PERFORM pg_notify('human_interview_reminder_changed', corrected.meeting_id);
  END LOOP;
END $$;

COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."error_code" IS '最近一次同步错误或停止原因：queue_sync_failed 队列同步失败、meeting_started 已到开始时间、meeting_inactive 会议未排期或已取消结束；正常排队时为空';
