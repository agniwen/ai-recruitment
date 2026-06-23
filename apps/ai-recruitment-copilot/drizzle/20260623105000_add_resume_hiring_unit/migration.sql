ALTER TABLE "studio_interview"
  ADD COLUMN "hiring_unit_id" text;

ALTER TABLE "studio_interview"
  ADD CONSTRAINT "studio_interview_hiring_unit_id_hiring_unit_id_fk"
  FOREIGN KEY ("hiring_unit_id") REFERENCES "public"."hiring_unit"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "studio_interview_hiring_unit_idx"
  ON "studio_interview" USING btree ("hiring_unit_id");
