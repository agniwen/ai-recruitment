-- DDL only: keep every existing relationship field and timestamp unchanged.
-- Existing nonblank emails keep the same uniqueness after the email: prefix.
CREATE UNIQUE INDEX ssc_responsibility_workspace_center_identity_uq
  ON ssc_responsibility (
    organization_id,
    lower(btrim(center_name)),
    (CASE
      WHEN btrim(email) <> '' THEN 'email:' || lower(btrim(email))
      WHEN btrim(telegram) <> '' THEN 'telegram:' || lower(btrim(telegram))
      WHEN btrim(ssc_name) <> '' THEN 'name:' || lower(btrim(ssc_name))
      ELSE 'unassigned'
    END)
  );

DROP INDEX ssc_responsibility_workspace_center_email_uq;

ALTER TABLE ssc_responsibility
  DROP CONSTRAINT ssc_responsibility_name_check,
  DROP CONSTRAINT ssc_responsibility_email_check;

COMMENT ON COLUMN ssc_responsibility.ssc_name IS 'SSC 花名，允许空字符串，支持负责人尚未明确时提前录入';
COMMENT ON COLUMN ssc_responsibility.email IS 'SSC 邮箱，允许空字符串；非空时校验邮箱并转为小写';
COMMENT ON INDEX ssc_responsibility_workspace_center_identity_uq IS '工作区与中心内按邮箱、TG、花名、未分配依次确定身份并去重；各类身份使用独立前缀';
