ALTER TABLE global_config ADD COLUMN candidate_entry_credential_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN global_config.candidate_entry_credential_enabled IS '工作空间候选人真人面试入场凭据验证开关；默认关闭，面试官不受影响';

ALTER TABLE studio_interview
  ADD COLUMN entry_credential_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN entry_credential_exemption_reason text,
  ADD COLUMN entry_credential_exemption_updated_at timestamptz,
  ADD COLUMN entry_credential_exemption_updated_by text;
COMMENT ON COLUMN studio_interview.entry_credential_exempt IS 'HR 是否为该候选人单独关闭入场凭据验证；作用于当前及后续真人面试，直到恢复';
COMMENT ON COLUMN studio_interview.entry_credential_exemption_reason IS '最近一次关闭或恢复入场凭据验证的原因；历史变更见候选人活动日志';
COMMENT ON COLUMN studio_interview.entry_credential_exemption_updated_at IS '最近一次入场凭据要求调整时间';
COMMENT ON COLUMN studio_interview.entry_credential_exemption_updated_by IS '最近一次调整入场凭据要求的成员 ID';

CREATE TABLE candidate_entry_credential (
  id text PRIMARY KEY,
  rp_id text NOT NULL,
  credential_id text NOT NULL,
  user_handle text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  backup_eligible boolean NOT NULL,
  backed_up boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX candidate_entry_credential_rp_key_idx ON candidate_entry_credential (rp_id, credential_id);
COMMENT ON TABLE candidate_entry_credential IS '经过服务端 WebAuthn 验证的入场凭据；与候选人身份解耦，不代表唯一设备或自然人；长期保留关联证据';
COMMENT ON COLUMN candidate_entry_credential.id IS '系统生成的入场凭据关联编号，K- 前缀，供后台展示';
COMMENT ON COLUMN candidate_entry_credential.rp_id IS '凭据所属站点域名，由服务端可信配置生成';
COMMENT ON COLUMN candidate_entry_credential.credential_id IS 'WebAuthn 原始凭据 ID，Base64URL 编码，与域名共同唯一；不在后台接口公开';
COMMENT ON COLUMN candidate_entry_credential.user_handle IS '创建时生成的随机用户句柄，不使用候选人或账号 ID；验证时必须匹配';
COMMENT ON COLUMN candidate_entry_credential.public_key IS 'WebAuthn COSE 公钥的 Base64URL 编码，用于验签；系统不保存私钥';
COMMENT ON COLUMN candidate_entry_credential.counter IS '最近验签成功后的签名计数器；按凭据行锁串行更新，可同步凭据通常为零';
COMMENT ON COLUMN candidate_entry_credential.backup_eligible IS '签名认证数据中的 BE 属性；为真表示凭据具备备份或同步能力，不证明已同步或当前使用设备';
COMMENT ON COLUMN candidate_entry_credential.backed_up IS '最近一次签名认证数据中的 BS 属性，表示认证器报告的备份状态';
COMMENT ON COLUMN candidate_entry_credential.created_at IS '凭据首次创建并经服务端验证的时间';
COMMENT ON COLUMN candidate_entry_credential.last_used_at IS '凭据最近一次经服务端验签成功的时间';

CREATE TABLE candidate_entry_challenge (
  id text PRIMARY KEY,
  challenge text NOT NULL,
  kind text NOT NULL,
  user_handle text,
  organization_id text NOT NULL,
  candidate_id text NOT NULL,
  meeting_id text NOT NULL,
  round_id text NOT NULL,
  visit_id text NOT NULL,
  invite_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX candidate_entry_challenge_expiry_idx ON candidate_entry_challenge (expires_at);
CREATE INDEX candidate_entry_challenge_visit_idx ON candidate_entry_challenge (invite_hash, visit_id);
COMMENT ON TABLE candidate_entry_challenge IS '入场凭据一次性验证挑战；五分钟有效，匹配作用域后先原子消费再验签，失败也不可复用；发起新验证时清理过期记录';
COMMENT ON COLUMN candidate_entry_challenge.id IS '本次验证挑战编号';
COMMENT ON COLUMN candidate_entry_challenge.challenge IS 'WebAuthn 随机挑战内容，必须与签名中的挑战一致';
COMMENT ON COLUMN candidate_entry_challenge.kind IS '操作类型：register 创建凭据，authenticate 验证已有凭据';
COMMENT ON COLUMN candidate_entry_challenge.user_handle IS '本次创建凭据的随机用户句柄；验证已有凭据时为空';
COMMENT ON COLUMN candidate_entry_challenge.organization_id IS '挑战绑定的工作空间 ID';
COMMENT ON COLUMN candidate_entry_challenge.candidate_id IS '挑战绑定的候选人记录 ID，对应 studio_interview.id';
COMMENT ON COLUMN candidate_entry_challenge.meeting_id IS '挑战绑定的真人面试会议 ID';
COMMENT ON COLUMN candidate_entry_challenge.round_id IS '挑战绑定的真人面试轮次 ID';
COMMENT ON COLUMN candidate_entry_challenge.visit_id IS '挑战绑定的页面访问编号，与面试日志一致';
COMMENT ON COLUMN candidate_entry_challenge.invite_hash IS '候选人邀请令牌的 SHA-256 摘要，不保存原始邀请令牌';
COMMENT ON COLUMN candidate_entry_challenge.expires_at IS '挑战到期时间，超过此时间拒绝验证';

CREATE TABLE candidate_entry_credential_use (
  id text PRIMARY KEY,
  credential_ref text NOT NULL,
  organization_id text NOT NULL,
  candidate_id text NOT NULL,
  candidate_name text NOT NULL,
  meeting_id text NOT NULL,
  round_id text NOT NULL,
  visit_id text NOT NULL,
  invite_hash text NOT NULL,
  proof_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  method text NOT NULL,
  browser_id text,
  fingerprint_id text,
  ip text,
  user_agent text,
  properties jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX candidate_entry_use_proof_idx ON candidate_entry_credential_use (proof_hash);
CREATE INDEX candidate_entry_use_meeting_idx ON candidate_entry_credential_use (meeting_id);
CREATE INDEX candidate_entry_use_credential_idx ON candidate_entry_credential_use (credential_ref, organization_id);
COMMENT ON TABLE candidate_entry_credential_use IS '入场凭据验证成功的关联证据与短期入会许可；证据长期保留，许可三十分钟有效；无删除级联，统计按工作空间隔离';
COMMENT ON COLUMN candidate_entry_credential_use.id IS '本次凭据使用记录编号';
COMMENT ON COLUMN candidate_entry_credential_use.credential_ref IS '关联入场凭据编号，对应 candidate_entry_credential.id';
COMMENT ON COLUMN candidate_entry_credential_use.organization_id IS '验证所属工作空间 ID，跨候选人关联统计不得跨工作空间';
COMMENT ON COLUMN candidate_entry_credential_use.candidate_id IS '邀请链接对应的候选人记录 ID；凭据自身不提供候选人身份认证';
COMMENT ON COLUMN candidate_entry_credential_use.candidate_name IS '验证时的候选人姓名快照';
COMMENT ON COLUMN candidate_entry_credential_use.meeting_id IS '本次验证关联的真人面试会议 ID';
COMMENT ON COLUMN candidate_entry_credential_use.round_id IS '本次验证关联的真人面试轮次 ID';
COMMENT ON COLUMN candidate_entry_credential_use.visit_id IS '本次验证的页面访问编号，可关联面试过程日志';
COMMENT ON COLUMN candidate_entry_credential_use.invite_hash IS '绑定邀请令牌的 SHA-256 摘要，禁止替换邀请链接使用';
COMMENT ON COLUMN candidate_entry_credential_use.proof_hash IS '短期入会许可的 SHA-256 摘要；原文仅返回浏览器内存，不写日志';
COMMENT ON COLUMN candidate_entry_credential_use.expires_at IS '本次入会许可的过期时间；过期只影响许可，不清理历史证据';
COMMENT ON COLUMN candidate_entry_credential_use.method IS '验证方式：register 首次创建，authenticate 使用已有凭据';
COMMENT ON COLUMN candidate_entry_credential_use.browser_id IS '验证时客户端上报的浏览器本地标识，非硬件设备码';
COMMENT ON COLUMN candidate_entry_credential_use.fingerprint_id IS '验证时客户端上报的 FingerprintJS 浏览器指纹；尚未获取时为空，可按访问编号查询日志';
COMMENT ON COLUMN candidate_entry_credential_use.ip IS '验证请求经服务端可信代理规则解析的来源 IP，缺少可靠来源时为空';
COMMENT ON COLUMN candidate_entry_credential_use.user_agent IS '验证请求的浏览器 User-Agent';
COMMENT ON COLUMN candidate_entry_credential_use.properties IS '本次验签得到的凭据属性快照：backupEligible 可备份，backedUp 已备份；不能由此认定物理设备';
COMMENT ON COLUMN candidate_entry_credential_use.created_at IS '本次服务端验签成功时间';
