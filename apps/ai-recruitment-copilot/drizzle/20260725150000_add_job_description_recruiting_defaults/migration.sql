UPDATE "job_description"
SET "priority" = CASE
  WHEN UPPER(TRIM("priority")) IN ('P0', 'P1', 'P2') THEN UPPER(TRIM("priority"))
  ELSE 'P0'
END;

ALTER TABLE "job_description"
  ALTER COLUMN "priority" SET DEFAULT 'P0',
  ALTER COLUMN "priority" SET NOT NULL,
  ADD COLUMN "work_start_time" text,
  ADD COLUMN "work_end_time" text,
  ADD COLUMN "work_timezone" text,
  ADD CONSTRAINT "job_description_priority_check"
    CHECK ("priority" IN ('P0', 'P1', 'P2'));

CREATE TABLE "job_description_human_interviewer" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "job_description_id" text NOT NULL,
  "user_id" text NOT NULL,
  CONSTRAINT "job_description_human_interviewer_job_description_id_user_id_pk"
    PRIMARY KEY ("job_description_id", "user_id"),
  CONSTRAINT "job_description_human_interviewer_job_description_id_job_description_id_fk"
    FOREIGN KEY ("job_description_id") REFERENCES "public"."job_description"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "job_description_human_interviewer_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action
);

CREATE INDEX "job_description_human_interviewer_user_idx"
  ON "job_description_human_interviewer" USING btree ("user_id");
