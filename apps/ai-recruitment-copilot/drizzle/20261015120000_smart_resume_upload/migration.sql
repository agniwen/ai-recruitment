CREATE TABLE job_matching_profile (
  job_description_id text PRIMARY KEY REFERENCES job_description(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  source_hash text NOT NULL,
  confirmed_at timestamptz,
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE smart_resume_task (
  id text PRIMARY KEY REFERENCES resume_upload_batch(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);
CREATE INDEX smart_resume_task_unsubmitted_idx ON smart_resume_task(organization_id, created_by, created_at) WHERE submitted_at IS NULL;
CREATE TABLE smart_resume_task_item (
  id text PRIMARY KEY REFERENCES resume_upload_batch_item(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES smart_resume_task(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  error text,
  result jsonb,
  selected_job_ids jsonb NOT NULL DEFAULT '[]',
  selection_touched boolean NOT NULL DEFAULT false,
  skipped boolean NOT NULL DEFAULT false,
  created_record_ids jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX smart_resume_task_item_task_idx ON smart_resume_task_item(task_id);
COMMENT ON TABLE smart_resume_task_item IS '智能上传待提交任务；保留原始推荐与最终去向，用于内部质量评估';
