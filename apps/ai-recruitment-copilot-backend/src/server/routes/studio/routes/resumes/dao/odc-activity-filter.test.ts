import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildOdcActivityCondition } from "./resumes";

describe("ODC activity drilldown filters", () => {
  it("uses Beijing day bounds for AI interview schedules", () => {
    const condition = buildOdcActivityCondition("ai_interview", "2026-08-23", "2026-08-23");
    const query = new PgDialect().sqlToQuery(condition ?? sql`false`);

    expect(query.sql).toContain("studio_interview_schedule");
    expect(query.sql).toContain("scheduled_at");
    expect(query.params).toContain("2026-08-22T16:00:00.000Z");
    expect(query.params).toContain("2026-08-23T16:00:00.000Z");
  });

  it("filters current pending evaluations by their association date", () => {
    const condition = buildOdcActivityCondition("pending_evaluation", "2026-08-01", "2026-08-31");
    const query = new PgDialect().sqlToQuery(condition ?? sql`false`);

    expect(query.sql).toContain("resume_evaluation_status");
    expect(query.sql).toContain("pipeline_stage");
    expect(query.params).toContain("screening");
  });
});
