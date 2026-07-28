ALTER TABLE "resume_upload_batch"
ADD COLUMN "recruitment_source" text,
ADD COLUMN "recruitment_source_detail" text;

ALTER TABLE "studio_interview"
ADD COLUMN "recruitment_source" text,
ADD COLUMN "recruitment_source_detail" text;

ALTER TABLE "resume_upload_batch"
ADD CONSTRAINT "resume_upload_batch_recruitment_source_check"
CHECK (
  "recruitment_source" IS NULL
  OR "recruitment_source" IN (
    'boss',
    'zhilian',
    'liepin',
    'xiaohongshu',
    'tg',
    'referral',
    'other'
  )
);

ALTER TABLE "studio_interview"
ADD CONSTRAINT "studio_interview_recruitment_source_check"
CHECK (
  "recruitment_source" IS NULL
  OR "recruitment_source" IN (
    'boss',
    'zhilian',
    'liepin',
    'xiaohongshu',
    'tg',
    'referral',
    'other'
  )
);
