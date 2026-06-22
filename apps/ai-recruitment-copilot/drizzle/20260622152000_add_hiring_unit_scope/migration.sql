ALTER TABLE "department"
  ADD COLUMN IF NOT EXISTS "hiring_unit_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'department_hiring_unit_id_hiring_unit_id_fk'
  ) THEN
    ALTER TABLE "department"
      ADD CONSTRAINT "department_hiring_unit_id_hiring_unit_id_fk"
      FOREIGN KEY ("hiring_unit_id") REFERENCES "public"."hiring_unit"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "recruiting_group_hiring_unit" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "group_id" text NOT NULL,
  "hiring_unit_id" text NOT NULL,
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiting_group_hiring_unit_created_by_user_id_fk'
  ) THEN
    ALTER TABLE "recruiting_group_hiring_unit"
      ADD CONSTRAINT "recruiting_group_hiring_unit_created_by_user_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiting_group_hiring_unit_group_id_recruiting_group_id_fk'
  ) THEN
    ALTER TABLE "recruiting_group_hiring_unit"
      ADD CONSTRAINT "recruiting_group_hiring_unit_group_id_recruiting_group_id_fk"
      FOREIGN KEY ("group_id") REFERENCES "public"."recruiting_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiting_group_hiring_unit_hiring_unit_id_hiring_unit_id_fk'
  ) THEN
    ALTER TABLE "recruiting_group_hiring_unit"
      ADD CONSTRAINT "recruiting_group_hiring_unit_hiring_unit_id_hiring_unit_id_fk"
      FOREIGN KEY ("hiring_unit_id") REFERENCES "public"."hiring_unit"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiting_group_hiring_unit_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "recruiting_group_hiring_unit"
      ADD CONSTRAINT "recruiting_group_hiring_unit_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "department_hiring_unit_idx"
  ON "department" USING btree ("organization_id", "hiring_unit_id");

CREATE UNIQUE INDEX IF NOT EXISTS "recruiting_group_hiring_unit_uq"
  ON "recruiting_group_hiring_unit" USING btree ("organization_id", "group_id", "hiring_unit_id");

CREATE INDEX IF NOT EXISTS "recruiting_group_hiring_unit_group_idx"
  ON "recruiting_group_hiring_unit" USING btree ("organization_id", "group_id");

CREATE INDEX IF NOT EXISTS "recruiting_group_hiring_unit_unit_idx"
  ON "recruiting_group_hiring_unit" USING btree ("organization_id", "hiring_unit_id");
