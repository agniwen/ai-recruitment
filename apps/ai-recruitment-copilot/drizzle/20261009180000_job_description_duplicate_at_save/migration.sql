ALTER TABLE job_description ADD COLUMN duplicate_at_save boolean;
ALTER TABLE job_description ADD COLUMN duplicate_checked_at timestamptz;
CREATE INDEX job_description_duplicate_lookup_idx
  ON job_description (organization_id, department_id, btrim(name));
COMMENT ON COLUMN job_description.duplicate_at_save IS
  '保存时岗位、部门、服务单位、来源表格、需求发起人、简历对接人均与其他记录一致；NULL=尚未检查，不随其他岗位变更回算';
