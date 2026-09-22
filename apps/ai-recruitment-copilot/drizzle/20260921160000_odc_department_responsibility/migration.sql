CREATE TABLE IF NOT EXISTS odc_department_responsibility (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  member_id text NOT NULL,
  resume_source_id text NOT NULL,
  department_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resume_source_id, member_id) REFERENCES resume_source_odc_member(resume_source_id, member_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id) REFERENCES member(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, resume_source_id) REFERENCES resume_source(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, department_id) REFERENCES department(organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS odc_department_responsibility_uq
ON odc_department_responsibility(organization_id, member_id, resume_source_id, coalesce(department_id, ''));
