ALTER TABLE "member" ADD COLUMN "odc_scope_mode" text DEFAULT 'selected' NOT NULL;
--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_odc_scope_mode_check" CHECK ("odc_scope_mode" IN ('all', 'selected'));
--> statement-breakpoint
ALTER TABLE "platform_pre_registration" ADD COLUMN "odc_scope_mode" text DEFAULT 'selected' NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_pre_registration" ADD CONSTRAINT "pre_registration_odc_scope_mode_check" CHECK ("odc_scope_mode" IN ('all', 'selected'));
