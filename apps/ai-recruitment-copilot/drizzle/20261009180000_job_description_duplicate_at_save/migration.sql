ALTER TABLE job_description ADD COLUMN duplicate_at_save boolean;
ALTER TABLE job_description ADD COLUMN duplicate_checked_at timestamptz;
CREATE INDEX job_description_duplicate_lookup_idx
  ON job_description (organization_id, department_id, btrim(name));

-- 中文表注释与字段说明，便于直接查询数据库时理解记录含义。
COMMENT ON COLUMN "public"."job_description"."duplicate_at_save" IS '保存当时是否存在同一工作区内岗位、部门、服务单位、来源表格、需求发起人、简历对接人均一致的其他记录；true 重复、false 不重复、NULL 尚未检查，不随其他岗位变化重新计算';
COMMENT ON COLUMN "public"."job_description"."duplicate_checked_at" IS '最近一次保存岗位时执行重复检查的时间；与 duplicate_at_save 同时更新，历史未检查记录为空';
