CREATE TABLE interview_media_room (
 room_sid text PRIMARY KEY, room_name text NOT NULL, meeting_id text NOT NULL,
 meeting_title text NOT NULL, organization_id text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz, status text NOT NULL DEFAULT 'waiting', error_code text,
 lease_owner text, lease_until timestamptz, heartbeat_at timestamptz
);
CREATE INDEX interview_media_room_meeting_idx ON interview_media_room(meeting_id, started_at);
CREATE INDEX interview_media_room_started_idx ON interview_media_room(started_at);
CREATE TABLE interview_media_asset (
 id text PRIMARY KEY, meeting_id text NOT NULL, room_sid text NOT NULL, participant_sid text NOT NULL,
 participant_identity text NOT NULL, participant_name text NOT NULL, participant_role text NOT NULL,
 track_sid text, kind text NOT NULL, slot text NOT NULL, status text NOT NULL, captured_at timestamptz NOT NULL,
 duration_ms integer, byte_size integer, content_type text, storage_key text, storage_backend text,
 sha256 text, error_code text, environment jsonb NOT NULL DEFAULT '{}', deleted_at timestamptz, deleted_by text
);
CREATE INDEX interview_media_asset_meeting_time_idx ON interview_media_asset(meeting_id, captured_at);
CREATE INDEX interview_media_asset_pending_idx ON interview_media_asset(captured_at) WHERE status = 'pending';
CREATE UNIQUE INDEX interview_media_asset_slot_idx ON interview_media_asset(room_sid, participant_sid, kind, slot);
CREATE TABLE interview_media_access (
 id text PRIMARY KEY, asset_id text NOT NULL, actor_id text NOT NULL, action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_media_access_asset_idx ON interview_media_access(asset_id, created_at);

-- 中文表注释与字段说明，便于直接查询数据库时理解记录含义。
COMMENT ON TABLE "public"."interview_media_room" IS '真人面试音视频留底房间档案；按 LiveKit 房间实例保存会议快照、采样运行状态和 Worker 租约，独立于普通日志长期保留';
COMMENT ON COLUMN "public"."interview_media_room"."room_sid" IS 'LiveKit 房间实例 SID，同时为档案主键；同一业务会议重建房间可形成多个档案';
COMMENT ON COLUMN "public"."interview_media_room"."room_name" IS 'LiveKit 房间业务名称';
COMMENT ON COLUMN "public"."interview_media_room"."meeting_id" IS '关联真人面试会议 ID；不随会议删除级联清除';
COMMENT ON COLUMN "public"."interview_media_room"."meeting_title" IS '会议标题快照，后续房间登记时可更新';
COMMENT ON COLUMN "public"."interview_media_room"."organization_id" IS '会议所属工作区 ID 快照';
COMMENT ON COLUMN "public"."interview_media_room"."started_at" IS '留底房间档案首次建立时间，不等同于业务面试正式开始时间';
COMMENT ON COLUMN "public"."interview_media_room"."ended_at" IS '收到 LiveKit 房间结束通知时记录的时间；为空表示尚未确认房间结束';
COMMENT ON COLUMN "public"."interview_media_room"."status" IS '采样状态：waiting 等待采样、capturing 采样中、stopped 已停止、error 采样异常';
COMMENT ON COLUMN "public"."interview_media_room"."error_code" IS '最近一次房间采样停止时的错误代码，无错误时为空';
COMMENT ON COLUMN "public"."interview_media_room"."lease_owner" IS '当前持有房间采样租约的 Worker 实例标识，防止多个实例同时采样';
COMMENT ON COLUMN "public"."interview_media_room"."lease_until" IS '采样租约有效期；过期后其他 Worker 可接管，释放时清空';
COMMENT ON COLUMN "public"."interview_media_room"."heartbeat_at" IS '采样 Worker 最近领取或续租的心跳时间';
COMMENT ON TABLE "public"."interview_media_asset" IS '真人面试截图及短音频留底明细；每个参与者每个采样时间槽一条，保存文件元数据、设备环境和失败原因；文件存于私有存储，管理员清理后保留删除标记';
COMMENT ON COLUMN "public"."interview_media_asset"."id" IS '留底资料记录 ID，也是文件存储键中的唯一标识';
COMMENT ON COLUMN "public"."interview_media_asset"."meeting_id" IS '关联真人面试会议 ID；不随会议删除或普通日志过期而清除';
COMMENT ON COLUMN "public"."interview_media_asset"."room_sid" IS '采样所属的 LiveKit 房间实例 SID，对应 interview_media_room.room_sid';
COMMENT ON COLUMN "public"."interview_media_asset"."participant_sid" IS '本次采样的 LiveKit 参与者连接 SID，用于区分同一参与身份的不同连接';
COMMENT ON COLUMN "public"."interview_media_asset"."participant_identity" IS '采样对象的 LiveKit 参与身份，用于关联候选人或面试官';
COMMENT ON COLUMN "public"."interview_media_asset"."participant_name" IS '采样时的参与者显示名称快照';
COMMENT ON COLUMN "public"."interview_media_asset"."participant_role" IS '采样时的参与角色：candidate 候选人、host 主持人、interviewer 面试官、observer 旁听，无法解析时为 unknown';
COMMENT ON COLUMN "public"."interview_media_asset"."track_sid" IS '采样音频或摄像头轨道的 LiveKit SID；无轨道而跳过时可为空';
COMMENT ON COLUMN "public"."interview_media_asset"."kind" IS '留底类型：image 摄像头截图、audio 麦克风短音频片段';
COMMENT ON COLUMN "public"."interview_media_asset"."slot" IS '采样时间槽标识；与房间 SID、参与者 SID 和资料类型共同去重，避免多 Worker 重复留底';
COMMENT ON COLUMN "public"."interview_media_asset"."status" IS '资料状态：pending 采集中或上传中、ready 可查看、failed 采集失败、skipped 条件不满足而跳过、deleted 已由管理员清理';
COMMENT ON COLUMN "public"."interview_media_asset"."captured_at" IS '采样记录创建时间，即本次采样尝试开始时间';
COMMENT ON COLUMN "public"."interview_media_asset"."duration_ms" IS '实际音频片段时长，单位毫秒；截图或未成功采样时可为空';
COMMENT ON COLUMN "public"."interview_media_asset"."byte_size" IS '文件大小，单位字节；尚未成功上传时为空';
COMMENT ON COLUMN "public"."interview_media_asset"."content_type" IS '文件 MIME 类型，如 image/jpeg 或 audio/wav';
COMMENT ON COLUMN "public"."interview_media_asset"."storage_key" IS '私有存储中的文件对象键，不是公开访问 URL；采样前登记，清理后保留便于审计';
COMMENT ON COLUMN "public"."interview_media_asset"."storage_backend" IS '文件存储后端：r2 私有对象存储、local 本地开发目录；未产生文件时可为空';
COMMENT ON COLUMN "public"."interview_media_asset"."sha256" IS '文件内容的 SHA-256 摘要，用于完整性核对和相同文件比对，不是人脸或声纹识别结果';
COMMENT ON COLUMN "public"."interview_media_asset"."error_code" IS '采样失败或跳过原因代码，如静音、无轨道、订阅超时、采集或上传失败';
COMMENT ON COLUMN "public"."interview_media_asset"."environment" IS '采样连接的设备环境快照 JSON：attemptId、visitId、tabId、browserId、fingerprint、fingerprintVersion、ip、ipSource、userAgent；按连接和访问关联，缺失字段不推断，标识不能单独证明真实身份';
COMMENT ON COLUMN "public"."interview_media_asset"."deleted_at" IS '管理员成功清理文件并标记删除的时间；未清理时为空';
COMMENT ON COLUMN "public"."interview_media_asset"."deleted_by" IS '执行资料清理的平台管理员用户 ID；未清理时为空';
COMMENT ON TABLE "public"."interview_media_access" IS '真人面试留底资料管理员访问审计；记录资料读取和成功清理操作，独立长期保留';
COMMENT ON COLUMN "public"."interview_media_access"."id" IS '访问审计记录主键';
COMMENT ON COLUMN "public"."interview_media_access"."asset_id" IS '被查看或清理的留底资料 ID，对应 interview_media_asset.id';
COMMENT ON COLUMN "public"."interview_media_access"."actor_id" IS '执行操作的平台管理员用户 ID';
COMMENT ON COLUMN "public"."interview_media_access"."action" IS '操作类型：view 读取资料内容、delete 成功清理资料';
COMMENT ON COLUMN "public"."interview_media_access"."created_at" IS '访问或清理审计记录创建时间';
