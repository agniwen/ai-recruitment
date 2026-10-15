ALTER TABLE smart_resume_task_item
ADD COLUMN portfolio_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
