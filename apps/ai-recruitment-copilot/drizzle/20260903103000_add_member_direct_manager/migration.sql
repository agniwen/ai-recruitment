CREATE UNIQUE INDEX IF NOT EXISTS "member_organization_id_id_uq"
  ON "member" USING btree ("organization_id", "id");

CREATE TABLE IF NOT EXISTS "member_reporting_line" (
  "organization_id" text NOT NULL,
  "member_id" text NOT NULL,
  "direct_manager_id" text NOT NULL,
  CONSTRAINT "member_reporting_line_organization_id_member_id_pk"
    PRIMARY KEY ("organization_id", "member_id"),
  CONSTRAINT "member_reporting_line_not_self"
    CHECK ("direct_manager_id" <> "member_id"),
  CONSTRAINT "member_reporting_line_member_fk"
    FOREIGN KEY ("organization_id", "member_id")
    REFERENCES "public"."member"("organization_id", "id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "member_reporting_line_direct_manager_fk"
    FOREIGN KEY ("organization_id", "direct_manager_id")
    REFERENCES "public"."member"("organization_id", "id")
    ON DELETE cascade
    ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "member_reporting_line_manager_idx"
  ON "member_reporting_line" USING btree ("organization_id", "direct_manager_id");
