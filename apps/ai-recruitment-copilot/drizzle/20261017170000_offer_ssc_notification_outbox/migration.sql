CREATE TABLE studio_offer_ssc_notification_outbox (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES studio_offer_draft(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  interview_record_id text NOT NULL REFERENCES studio_interview(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  event text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  recipient_user_ids jsonb,
  sent_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_ssc_outbox_event_check CHECK (event IN ('pending', 'received', 'completed')),
  CONSTRAINT offer_ssc_outbox_revision_check CHECK (revision > 0),
  CONSTRAINT offer_ssc_outbox_attempts_check CHECK (attempts >= 0),
  CONSTRAINT offer_ssc_outbox_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT offer_ssc_outbox_lease_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  )
);

CREATE UNIQUE INDEX offer_ssc_outbox_event_uniq
  ON studio_offer_ssc_notification_outbox(draft_id, revision, event);
CREATE INDEX offer_ssc_outbox_pending_idx
  ON studio_offer_ssc_notification_outbox(available_at) WHERE status = 'pending';
CREATE INDEX offer_ssc_outbox_lease_idx
  ON studio_offer_ssc_notification_outbox(lease_until) WHERE status = 'processing';
CREATE INDEX offer_ssc_outbox_org_idx ON studio_offer_ssc_notification_outbox(organization_id);

COMMENT ON TABLE studio_offer_ssc_notification_outbox IS 'Offer SSC 通知事务发件箱；按 Offer、内容版本和事件去重，提交后由 Worker 发送，不回填历史事件';
COMMENT ON COLUMN studio_offer_ssc_notification_outbox.recipient_user_ids IS '首次处理时冻结的收件人用户 ID；NULL 表示尚未解析，每次发送前仍复核当前权限与 TG 绑定';
COMMENT ON COLUMN studio_offer_ssc_notification_outbox.sent_user_ids IS '已发送成功并持久确认的用户 ID；失败重试与 Worker 重启不会重复发送这些收件人';
COMMENT ON COLUMN studio_offer_ssc_notification_outbox.lease_token IS '领取尝试的随机令牌；续租与发送结果回写均校验令牌和有效期，防过期 Worker 覆盖新尝试';
COMMENT ON COLUMN studio_offer_ssc_notification_outbox.attempts IS '已领取发送尝试次数，最多实际发送五次；最终尝试崩溃后仅终止，不再次发送';
