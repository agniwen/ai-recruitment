ALTER TABLE candidate_entry_credential ADD COLUMN aaguid text;
COMMENT ON COLUMN candidate_entry_credential.aaguid IS '从服务端验证通过的注册认证数据解析的 AAGUID，用于凭据提供方或认证器型号归类；历史未采集为 NULL，全零表示未知；无可信设备证明时不可作为防作弊或设备唯一标识';

ALTER TABLE candidate_entry_credential_use ADD COLUMN webauthn_response jsonb;
COMMENT ON COLUMN candidate_entry_credential_use.webauthn_response IS '本次服务端验证成功的 WebAuthn 完整响应 JSON（SimpleWebAuthn 序列化，二进制以 Base64URL 保存）；包含凭据 ID、响应和扩展等，不含私钥、PIN 或生物识别数据；附加客户端字段不保证真实性，历史未采集为 NULL';
