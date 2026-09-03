ALTER TABLE "platform_pre_registration"
  ADD COLUMN "direct_manager_email" text;

UPDATE "platform_pre_registration" AS child
SET "direct_manager_email" = lower(manager."email")
FROM "platform_pre_registration" AS manager
WHERE child."direct_manager_id" = manager."id";

ALTER TABLE "platform_pre_registration"
  DROP CONSTRAINT "platform_pre_registration_direct_manager_fk";
ALTER TABLE "platform_pre_registration"
  DROP CONSTRAINT "platform_pre_registration_not_self_managed";
DROP INDEX IF EXISTS "platform_pre_registration_manager_idx";

ALTER TABLE "platform_pre_registration"
  DROP COLUMN "direct_manager_id";
ALTER TABLE "platform_pre_registration"
  ADD CONSTRAINT "platform_pre_registration_not_self_managed"
  CHECK (
    "direct_manager_email" IS NULL
    OR lower("direct_manager_email") <> lower("email")
  );

CREATE INDEX "platform_pre_registration_manager_email_idx"
  ON "platform_pre_registration" USING btree (
    "workspace_slug",
    lower("direct_manager_email")
  );
