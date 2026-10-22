ALTER TABLE "studio_offer_draft" ADD COLUMN "recruiter_confirmation_status" text;
--> statement-breakpoint
ALTER TABLE "studio_offer_draft" ADD COLUMN "recruiter_confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "studio_offer_draft" ADD COLUMN "recruiter_confirmed_by" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "studio_offer_draft" ADD COLUMN "recruiter_confirmed_source" text;
--> statement-breakpoint
ALTER TABLE "studio_offer_draft" ADD CONSTRAINT "studio_offer_draft_recruiter_status_check" CHECK ("recruiter_confirmation_status" IS NULL OR "recruiter_confirmation_status" IN ('pending', 'completed'));
--> statement-breakpoint
ALTER TABLE "studio_offer_draft" ADD CONSTRAINT "studio_offer_draft_recruiter_source_check" CHECK ("recruiter_confirmed_source" IS NULL OR "recruiter_confirmed_source" IN ('system', 'telegram'));
--> statement-breakpoint
ALTER TABLE "studio_offer_ssc_notification_outbox" DROP CONSTRAINT "offer_ssc_outbox_event_check";
--> statement-breakpoint
ALTER TABLE "studio_offer_ssc_notification_outbox" ADD CONSTRAINT "offer_ssc_outbox_event_check" CHECK ("event" IN ('recruiter', 'pending', 'received', 'completed'));
