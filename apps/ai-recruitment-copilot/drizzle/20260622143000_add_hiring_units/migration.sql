CREATE TABLE IF NOT EXISTS "hiring_unit" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "description" text,
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "organization_id" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hiring_unit_created_by_user_id_fk'
  ) THEN
    ALTER TABLE "hiring_unit"
      ADD CONSTRAINT "hiring_unit_created_by_user_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hiring_unit_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "hiring_unit"
      ADD CONSTRAINT "hiring_unit_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "hiring_unit_name_idx"
  ON "hiring_unit" USING btree ("name");

CREATE INDEX IF NOT EXISTS "hiring_unit_created_at_idx"
  ON "hiring_unit" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "hiring_unit_organization_idx"
  ON "hiring_unit" USING btree ("organization_id");
