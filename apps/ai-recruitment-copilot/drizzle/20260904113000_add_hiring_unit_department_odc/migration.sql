ALTER TABLE "hiring_unit"
ADD COLUMN "odc_member_id" text;

ALTER TABLE "hiring_unit"
ADD CONSTRAINT "hiring_unit_odc_member_id_member_id_fk"
FOREIGN KEY ("odc_member_id") REFERENCES "public"."member"("id")
ON DELETE set null ON UPDATE no action;

CREATE INDEX "hiring_unit_odc_member_idx"
ON "hiring_unit" USING btree ("odc_member_id");

ALTER TABLE "department"
ADD COLUMN "odc_member_id" text;

ALTER TABLE "department"
ADD CONSTRAINT "department_odc_member_id_member_id_fk"
FOREIGN KEY ("odc_member_id") REFERENCES "public"."member"("id")
ON DELETE set null ON UPDATE no action;

CREATE INDEX "department_odc_member_idx"
ON "department" USING btree ("odc_member_id");
