CREATE TABLE ssc_responsibility (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  demand_owner text NOT NULL DEFAULT '',
  center_name text NOT NULL,
  ssc_name text NOT NULL,
  telegram text NOT NULL DEFAULT '',
  email text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ssc_responsibility_center_check CHECK (length(btrim(center_name)) > 0),
  CONSTRAINT ssc_responsibility_name_check CHECK (length(btrim(ssc_name)) > 0),
  CONSTRAINT ssc_responsibility_email_check CHECK (length(btrim(email)) > 0)
);

CREATE UNIQUE INDEX ssc_responsibility_workspace_center_email_uq
  ON ssc_responsibility(organization_id, lower(btrim(center_name)), lower(btrim(email)));
CREATE INDEX ssc_responsibility_org_center_idx ON ssc_responsibility(organization_id, center_name);

COMMENT ON TABLE ssc_responsibility IS 'SSC 负责组织提前录入关系；按工作区独立维护，不创建成员、不授予权限、不改变通知路由';
COMMENT ON COLUMN ssc_responsibility.demand_owner IS '需求对接负责人，允许为空字符串';
COMMENT ON COLUMN ssc_responsibility.center_name IS '中心/部门文本；无须存在于来源、用人组织或部门目录';
COMMENT ON COLUMN ssc_responsibility.ssc_name IS 'SSC 花名；无须已有注册账号或成员';
COMMENT ON COLUMN ssc_responsibility.telegram IS 'SSC TG 文本资料，不代表已验证的机器人绑定';
COMMENT ON COLUMN ssc_responsibility.email IS 'SSC 邮箱；保存时去除首尾空白并转为小写';
COMMENT ON COLUMN ssc_responsibility.notes IS '备注，允许为空字符串';
