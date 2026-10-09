ALTER TABLE "public"."interview_telemetry_event"
  ADD COLUMN "browser_id" text,
  ADD COLUMN "fingerprint_id" text,
  ADD COLUMN "fingerprint_version" text;

COMMENT ON COLUMN "public"."interview_telemetry_event"."browser_id" IS '浏览器本地存储的持久标识；同一浏览器刷新页面通常保持不变，清除站点数据或隐私模式可能变化，不是硬件设备码';
COMMENT ON COLUMN "public"."interview_telemetry_event"."fingerprint_id" IS 'FingerprintJS 采集的浏览器指纹 ID；用于跨页面访问查询和对比浏览器环境，不随 visit_id 或 tab_id 的重新生成而必然变化；未采集或采集失败时为空，不单独作为真实身份或作弊结论';
COMMENT ON COLUMN "public"."interview_telemetry_event"."fingerprint_version" IS '浏览器指纹采集器版本，如 fingerprintjs-5.3.0；指纹算法或浏览器环境变化可能影响结果';
COMMENT ON COLUMN "public"."interview_telemetry_event"."details" IS '事件扩展 JSON，记录网络指标、状态及错误原因等；浏览器标识和指纹现使用 browser_id、fingerprint_id、fingerprint_version 独立字段，旧客户端原始 JSON 保留兼容';
CREATE INDEX "interview_telemetry_event_fingerprint_idx"
  ON "public"."interview_telemetry_event" ("fingerprint_id", "meeting_id", "visit_id");

-- 兼容旧客户端已经保存在 details 中的证据，保留原始 JSON。
UPDATE interview_telemetry_event SET
  browser_id = CASE WHEN details->>'browserId' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN details->>'browserId' END,
  fingerprint_id = CASE WHEN details->>'fingerprint' ~* '^[a-f0-9]{32,64}$' THEN details->>'fingerprint' END,
  fingerprint_version = left(nullif(details->>'fingerprintVersion', ''), 200)
WHERE details ?| ARRAY['browserId', 'fingerprint', 'fingerprintVersion'];

-- 仅在同一会议、参与身份和访问实例内补齐唯一证据；冲突时保持为空，不按 IP 猜测。
WITH visits AS (
  SELECT meeting_id, participant_identity, visit_id,
    CASE WHEN count(DISTINCT browser_id) = 1 THEN max(browser_id) END AS browser_id,
    CASE WHEN count(DISTINCT fingerprint_id) FILTER (WHERE type = 'fingerprint_ready') = 1
      THEN max(fingerprint_id) FILTER (WHERE type = 'fingerprint_ready') END AS fingerprint_id,
    CASE WHEN count(DISTINCT fingerprint_version) FILTER (WHERE type = 'fingerprint_ready') = 1
      THEN max(fingerprint_version) FILTER (WHERE type = 'fingerprint_ready') END AS fingerprint_version
  FROM interview_telemetry_event
  WHERE source = 'client' AND visit_id IS NOT NULL
  GROUP BY meeting_id, participant_identity, visit_id
)
UPDATE interview_telemetry_event e SET
  browser_id = coalesce(e.browser_id, v.browser_id),
  fingerprint_id = coalesce(e.fingerprint_id, v.fingerprint_id),
  fingerprint_version = coalesce(e.fingerprint_version, v.fingerprint_version)
FROM visits v
WHERE e.meeting_id = v.meeting_id AND e.participant_identity = v.participant_identity
  AND e.visit_id = v.visit_id
  AND ((e.browser_id IS NULL AND v.browser_id IS NOT NULL)
    OR (e.fingerprint_id IS NULL AND v.fingerprint_id IS NOT NULL)
    OR (e.fingerprint_version IS NULL AND v.fingerprint_version IS NOT NULL));
