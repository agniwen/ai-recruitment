import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildResumeVisibilityCondition } from "../resume-visibility";

describe("buildResumeVisibilityCondition", () => {
  it("unions inherited recruiter records with hiring-unit and department ODC assignments", () => {
    const condition = buildResumeVisibilityCondition({
      odc: {
        departmentIds: ["department-1"],
        hiringUnitIds: ["hiring-unit-1"],
      },
      recruiting: { kind: "restricted", userIds: ["user-1"] },
    });
    if (!condition) {
      throw new Error("Expected a resume visibility condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"studio_interview"."created_by" in');
    expect(query.sql).toContain('"studio_interview"."hiring_unit_id" in');
    expect(query.sql).toContain('"department"."hiring_unit_id" in');
    expect(query.sql).toContain('"job_description"."department_id" in');
    expect(query.params).toEqual([
      "user-1",
      "hiring-unit-1",
      "hiring-unit-1",
      "hiring-unit-1",
      "department-1",
    ]);
  });

  it("does not grant sibling departments for a department-only ODC", () => {
    const condition = buildResumeVisibilityCondition({
      odc: { departmentIds: ["department-1"], hiringUnitIds: [] },
      recruiting: { kind: "none" },
    });
    if (!condition) {
      throw new Error("Expected a resume visibility condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"job_description"."department_id" in');
    expect(query.sql).not.toContain('"department"."hiring_unit_id" in');
    expect(query.params).toEqual(["department-1"]);
  });

  it("rechecks the current ODC role and assignments for resolved request scopes", () => {
    const condition = buildResumeVisibilityCondition({
      odc: { departmentIds: ["department-1"], hiringUnitIds: ["hiring-unit-1"] },
      odcActor: { organizationId: "organization-1", userId: "user-1" },
      recruiting: { kind: "none" },
    });
    if (!condition) {
      throw new Error("Expected a current ODC visibility condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"organization_role"."is_odc"');
    expect(query.sql).toContain('"hiring_unit_odc_member"');
    expect(query.sql).toContain('"department_odc_member"');
    expect(query.sql).toContain('"organization_role"."role" = "member"."role"');
  });
});
