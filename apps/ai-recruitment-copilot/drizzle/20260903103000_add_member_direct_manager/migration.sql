ALTER TABLE "member"
  ADD COLUMN IF NOT EXISTS "direct_manager_id" text;

DO $$ BEGIN
  ALTER TABLE "member"
    ADD CONSTRAINT "member_direct_manager_id_member_id_fk"
    FOREIGN KEY ("direct_manager_id")
    REFERENCES "public"."member"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "member"
    ADD CONSTRAINT "member_direct_manager_not_self"
    CHECK ("direct_manager_id" IS NULL OR "direct_manager_id" <> "id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "member_organization_direct_manager_idx"
  ON "member" USING btree ("organization_id", "direct_manager_id");
