ALTER TABLE "resume_source_odc_member" ADD COLUMN "can_approve_ai_review" boolean DEFAULT false NOT NULL;

ALTER TABLE "studio_interview" ALTER COLUMN "pipeline_stage" SET DEFAULT 'ai_review';
