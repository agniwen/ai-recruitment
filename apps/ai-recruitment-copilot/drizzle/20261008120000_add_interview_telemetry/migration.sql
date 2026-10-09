CREATE TABLE "interview_telemetry_event" (
  "id" text PRIMARY KEY,
  "event_key" text NOT NULL,
  "client_sequence" integer,
  "meeting_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "meeting_title" text NOT NULL,
  "room_name" text,
  "participant_identity" text NOT NULL DEFAULT '',
  "participant_name" text,
  "participant_role" text,
  "source" text NOT NULL,
  "type" text NOT NULL,
  "visit_id" text,
  "tab_id" text,
  "attempt_id" text,
  "room_sid" text,
  "participant_sid" text,
  "ip" text,
  "ip_source" text,
  "user_agent" text,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX "interview_telemetry_event_dedupe_idx" ON "interview_telemetry_event" ("meeting_id", "participant_identity", "source", "event_key");
CREATE INDEX "interview_telemetry_event_meeting_time_idx" ON "interview_telemetry_event" ("meeting_id", "received_at", "id");
CREATE INDEX "interview_telemetry_event_received_idx" ON "interview_telemetry_event" ("received_at");
CREATE INDEX "interview_telemetry_event_attempt_idx" ON "interview_telemetry_event" ("attempt_id");
CREATE INDEX "interview_telemetry_event_participant_idx" ON "interview_telemetry_event" ("participant_sid");
CREATE INDEX "interview_telemetry_event_visit_idx" ON "interview_telemetry_event" ("meeting_id", "visit_id", "participant_identity");
CREATE INDEX "interview_telemetry_event_room_idx" ON "interview_telemetry_event" ("room_name");

-- 中文表注释与字段说明，便于直接查询数据库时理解记录含义。
COMMENT ON TABLE "public"."interview_telemetry_event" IS '真人面试链路事件与通话质量日志；关联页面、服务端和 LiveKit 事件，保留会议快照以供删会后排查；按接收时间执行日志保留策略';
COMMENT ON COLUMN "public"."interview_telemetry_event"."id" IS '日志记录主键，与来源事件去重键独立';
COMMENT ON COLUMN "public"."interview_telemetry_event"."event_key" IS '来源事件去重键；与会议 ID、参与身份和事件来源组成唯一键，避免重复上报或回调重复入库';
COMMENT ON COLUMN "public"."interview_telemetry_event"."client_sequence" IS '同一次页面访问内递增的客户端事件序号；非客户端事件可为空';
COMMENT ON COLUMN "public"."interview_telemetry_event"."meeting_id" IS '关联真人面试会议 ID；保留快照，不因会议删除而级联清除';
COMMENT ON COLUMN "public"."interview_telemetry_event"."organization_id" IS '会议所属工作区 ID 快照';
COMMENT ON COLUMN "public"."interview_telemetry_event"."meeting_title" IS '事件记录时的会议标题快照，用于会议删除后的定位';
COMMENT ON COLUMN "public"."interview_telemetry_event"."room_name" IS 'LiveKit 房间业务名称，用于关联会议与房间事件';
COMMENT ON COLUMN "public"."interview_telemetry_event"."participant_identity" IS 'LiveKit 参与身份；候选人为 candidate_轮次ID，面试官为 interviewer_用户ID；房间级事件可为空字符串';
COMMENT ON COLUMN "public"."interview_telemetry_event"."participant_name" IS '参与者显示名称快照，未获取时为空';
COMMENT ON COLUMN "public"."interview_telemetry_event"."participant_role" IS '参与角色快照：candidate 候选人、host 主持人、interviewer 面试官、observer 旁听；未知时可为空';
COMMENT ON COLUMN "public"."interview_telemetry_event"."source" IS '事件来源：client 浏览器上报、server 业务服务端、livekit 已验签的 LiveKit 回调';
COMMENT ON COLUMN "public"."interview_telemetry_event"."type" IS '事件类型代码，如 page_opened 打开页面、token_issued 签发凭证、disconnected 断线、network_sample 通话质量采样、media_device_error 设备异常';
COMMENT ON COLUMN "public"."interview_telemetry_event"."visit_id" IS '页面访问实例 ID；关联同一次访问的指纹、操作及连接事件，刷新页面会重新生成';
COMMENT ON COLUMN "public"."interview_telemetry_event"."tab_id" IS '页面实例的标签页标识；独立随机生成，刷新或复制标签页会重新生成，不是浏览器原生标签页编号';
COMMENT ON COLUMN "public"."interview_telemetry_event"."attempt_id" IS '一次点击入会产生的连接尝试 ID；关联凭证签发与 RTC 会话，尚未尝试入会时可为空';
COMMENT ON COLUMN "public"."interview_telemetry_event"."room_sid" IS 'LiveKit 分配的房间实例 SID；房间重新创建时可能变化，与业务会议 ID 区分';
COMMENT ON COLUMN "public"."interview_telemetry_event"."participant_sid" IS 'LiveKit 分配的参与者连接 SID；用于定位具体连接实例，与参与身份区分';
COMMENT ON COLUMN "public"."interview_telemetry_event"."ip" IS '服务端从配置的可信反向代理请求头取得的 IP；无法可靠获取时为空，不直接信任客户端自报 IP';
COMMENT ON COLUMN "public"."interview_telemetry_event"."ip_source" IS 'IP 证据来源，如 trusted-proxy:请求头名；unavailable 表示请求 IP 无可靠来源，非请求事件可为空';
COMMENT ON COLUMN "public"."interview_telemetry_event"."user_agent" IS '服务端收到的浏览器 User-Agent，最多保留 512 字符；只能作为客户端特征线索';
COMMENT ON COLUMN "public"."interview_telemetry_event"."occurred_at" IS '来源记录的事件发生时间；客户端时间可能受设备时钟偏差影响';
COMMENT ON COLUMN "public"."interview_telemetry_event"."received_at" IS '服务端接收并入库的时间；用于稳定排序及日志保留清理';
COMMENT ON COLUMN "public"."interview_telemetry_event"."details" IS '事件扩展 JSON；按事件包含 browserId 浏览器存储标识、fingerprint 指纹、fingerprintVersion、网络质量指标、状态及错误原因；设备标识不是硬件序列号，不能单独据此认定同一人或作弊';
