CREATE UNIQUE INDEX "hiring_unit_organization_id_id_uq"
ON "hiring_unit" USING btree ("organization_id", "id");

CREATE UNIQUE INDEX "department_organization_id_id_uq"
ON "department" USING btree ("organization_id", "id");

CREATE TABLE "hiring_unit_odc_member" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "hiring_unit_id" text NOT NULL,
  "member_id" text NOT NULL,
  "organization_id" text NOT NULL,
  CONSTRAINT "hiring_unit_odc_member_hiring_unit_id_member_id_pk"
    PRIMARY KEY ("hiring_unit_id", "member_id"),
  CONSTRAINT "hiring_unit_odc_member_hiring_unit_id_hiring_unit_id_fk"
    FOREIGN KEY ("hiring_unit_id") REFERENCES "public"."hiring_unit"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "hiring_unit_odc_member_member_id_member_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "public"."member"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "hiring_unit_odc_member_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "hiring_unit_odc_member_hiring_unit_fk"
    FOREIGN KEY ("organization_id", "hiring_unit_id")
    REFERENCES "public"."hiring_unit"("organization_id", "id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "hiring_unit_odc_member_member_fk"
    FOREIGN KEY ("organization_id", "member_id")
    REFERENCES "public"."member"("organization_id", "id")
    ON DELETE cascade ON UPDATE no action
);

CREATE INDEX "hiring_unit_odc_member_organization_idx"
ON "hiring_unit_odc_member" USING btree ("organization_id");

CREATE INDEX "hiring_unit_odc_member_member_idx"
ON "hiring_unit_odc_member" USING btree ("organization_id", "member_id");

CREATE TABLE "department_odc_member" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "department_id" text NOT NULL,
  "member_id" text NOT NULL,
  "organization_id" text NOT NULL,
  CONSTRAINT "department_odc_member_department_id_member_id_pk"
    PRIMARY KEY ("department_id", "member_id"),
  CONSTRAINT "department_odc_member_department_id_department_id_fk"
    FOREIGN KEY ("department_id") REFERENCES "public"."department"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "department_odc_member_member_id_member_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "public"."member"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "department_odc_member_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "department_odc_member_department_fk"
    FOREIGN KEY ("organization_id", "department_id")
    REFERENCES "public"."department"("organization_id", "id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "department_odc_member_member_fk"
    FOREIGN KEY ("organization_id", "member_id")
    REFERENCES "public"."member"("organization_id", "id")
    ON DELETE cascade ON UPDATE no action
);

CREATE INDEX "department_odc_member_organization_idx"
ON "department_odc_member" USING btree ("organization_id");

CREATE INDEX "department_odc_member_member_idx"
ON "department_odc_member" USING btree ("organization_id", "member_id");

INSERT INTO "hiring_unit_odc_member" ("hiring_unit_id", "member_id", "organization_id")
SELECT hu."id", hu."odc_member_id", hu."organization_id"
FROM "hiring_unit" hu
INNER JOIN "member" m
  ON m."id" = hu."odc_member_id"
  AND m."organization_id" = hu."organization_id"
WHERE hu."odc_member_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "department_odc_member" ("department_id", "member_id", "organization_id")
SELECT d."id", d."odc_member_id", d."organization_id"
FROM "department" d
INNER JOIN "member" m
  ON m."id" = d."odc_member_id"
  AND m."organization_id" = d."organization_id"
WHERE d."odc_member_id" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "hiring_unit"
DROP CONSTRAINT "hiring_unit_odc_member_id_member_id_fk";

DROP INDEX "hiring_unit_odc_member_idx";

ALTER TABLE "hiring_unit"
DROP COLUMN "odc_member_id";

ALTER TABLE "department"
DROP CONSTRAINT "department_odc_member_id_member_id_fk";

DROP INDEX "department_odc_member_idx";

ALTER TABLE "department"
DROP COLUMN "odc_member_id";
