ALTER TABLE "resume_pool_item"
ADD COLUMN "recruitment_source" text,
ADD COLUMN "recruitment_source_detail" text;

ALTER TABLE "resume_pool_item"
ADD CONSTRAINT "resume_pool_item_recruitment_source_check"
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
