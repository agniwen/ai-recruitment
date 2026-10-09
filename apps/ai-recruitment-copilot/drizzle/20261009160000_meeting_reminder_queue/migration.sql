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

-- 中文表注释与字段说明，便于直接查询数据库时理解记录含义。
COMMENT ON TABLE "public"."studio_human_interview_reminder_schedule" IS '真人面试会议级 TG 提醒调度表；每场会议一条持久化待同步记录，驱动 BullMQ 延迟任务及故障补偿；会议删除后保留停用记录';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."meeting_id" IS '关联真人面试会议 ID，同时为本表主键；不建立级联删除外键';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."organization_id" IS '会议所属工作区 ID 快照';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."revision" IS '提醒排期版本；会议改期或启停状态变化时递增，用于区分旧任务并阻止过期提醒';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."scheduled_at" IS '当前版本的会议预约开始时间；提醒通常在此前十分钟执行，未排期时为空';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."active" IS '当前会议是否具备提醒调度资格；预约时间非空且会议状态为 scheduled 或 in_progress 时为真，取消、结束或删除时为假';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."queued_revision" IS '最近一次完成队列同步的排期版本；包括旧任务清理或停用同步，尚未同步时为空';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."next_sync_at" IS '下一次同步或补偿检查时间；Worker 按索引读取到期记录，为空表示无需继续同步';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."error_code" IS '最近一次队列同步错误代码，如 queue_sync_failed；无错误时为空';
COMMENT ON COLUMN "public"."studio_human_interview_reminder_schedule"."updated_at" IS '会议触发器最近更新提醒排期记录的时间';
COMMENT ON TABLE "public"."studio_human_interview_meeting_reminder_delivery" IS '当前会议级真人面试前十分钟 TG 提醒发送明细；按会议、排期版本和收件人去重，保存关联轮次、角色、发送结果及重试状态；删会后保留';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."meeting_id" IS '关联真人面试会议 ID；不随会议删除级联清除';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."revision" IS '本条发送记录对应的提醒排期版本，与调度表 revision 对应';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."recipient_key" IS '收件人去重键；已绑定时为 chat:聊天ID，未绑定时保留人员标识；同一会议和版本下唯一';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."round_ids" IS '该收件人有权接收的候选人面试轮次 ID 快照 JSON 数组，用于合并同场会议通知';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."scheduled_at" IS '发送时对应的会议预约开始时间快照';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."chat_id" IS 'Telegram 私聊目标 chat ID；未完成绑定时可为空';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."roles" IS '收件人通知角色快照 JSON 数组，如招聘人员、面试官、分配 ODC；同一聊天目标合并角色';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."status" IS '发送状态：sending 发送中、sent 已发送、failed 失败、unbound 未绑定 TG、skipped 已跳过';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."attempt_id" IS '最近一次领取发送任务的尝试 ID；回写结果时校验，防止过期 Worker 覆盖当前尝试';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."attempts" IS '已领取的发送尝试次数，初始为 0；当前每位收件人每个排期版本最多尝试三次';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."created_at" IS '该会议、排期版本和收件人组合首次建立发送记录的时间';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."last_attempt_at" IS '最近一次领取发送任务或记录未绑定状态的时间；用于重试间隔及发送超时判断';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."sent_at" IS '成功发送到 Telegram 的时间，未成功时为空';
COMMENT ON COLUMN "public"."studio_human_interview_meeting_reminder_delivery"."error_code" IS '发送失败或跳过原因代码，如 telegram_not_bound；成功时清空';
COMMENT ON FUNCTION "public"."sync_human_interview_reminder_schedule"() IS '在会议事务内同步提醒排期版本和启停状态，并发送提交后可见的 PostgreSQL 通知；改期、取消和删除统一以会议 ID 为准';
COMMENT ON TRIGGER "human_interview_reminder_schedule_changed" ON "public"."studio_human_interview_meeting" IS '会议新增、预约时间或状态更新、删除后同步 TG 提醒调度记录；普通资料修改与提前入会不重复创建排期版本';
