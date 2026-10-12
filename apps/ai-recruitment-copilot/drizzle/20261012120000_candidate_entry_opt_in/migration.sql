-- 改为平台管理员逐候选人开启；旧总开关及豁免状态不自动转换为开启。
-- 历史调整保留在 interview_audit_log，已验证凭据和使用记录不受影响。
ALTER TABLE studio_interview RENAME COLUMN entry_credential_exempt TO entry_credential_enabled;
ALTER TABLE studio_interview RENAME COLUMN entry_credential_exemption_reason TO entry_credential_reason;
ALTER TABLE studio_interview RENAME COLUMN entry_credential_exemption_updated_at TO entry_credential_updated_at;
ALTER TABLE studio_interview RENAME COLUMN entry_credential_exemption_updated_by TO entry_credential_updated_by;

UPDATE studio_interview SET
  entry_credential_enabled = false,
  entry_credential_reason = NULL,
  entry_credential_updated_at = NULL,
  entry_credential_updated_by = NULL;
ALTER TABLE studio_interview ALTER COLUMN entry_credential_enabled SET DEFAULT false;
ALTER TABLE global_config DROP COLUMN candidate_entry_credential_enabled;

COMMENT ON COLUMN studio_interview.entry_credential_enabled IS '候选人真人面试入场凭据验证开关；默认关闭，仅平台管理员可开启或关闭，作用于该候选人当前及后续真人面试';
COMMENT ON COLUMN studio_interview.entry_credential_reason IS '平台管理员最近一次开启或关闭入场凭据验证的原因；历史变更见候选人活动日志';
COMMENT ON COLUMN studio_interview.entry_credential_updated_at IS '平台管理员最近一次调整候选人入场凭据开关的时间';
COMMENT ON COLUMN studio_interview.entry_credential_updated_by IS '最近一次调整候选人入场凭据开关的平台管理员用户 ID';
