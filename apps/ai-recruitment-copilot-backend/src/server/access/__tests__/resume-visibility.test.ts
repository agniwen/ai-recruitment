import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { buildResumeVisibilityCondition } from "../resume-visibility";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle.mock() };
});

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
    expect(query.sql).not.toContain('"studio_interview"."hiring_unit_id" in');
    expect(query.sql).toContain('"department"."hiring_unit_id" in');
    expect(query.sql).toContain('"job_description"."department_id" in');
    expect(query.params).toEqual(["user-1", "hiring-unit-1", "hiring-unit-1", "department-1"]);
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
    expect(query.sql).toContain(
      '"job_description"."resume_source_id" = "resume_source_odc_member"."resume_source_id"',
    );
    expect(query.params).toContain("organization-1");
    expect(query.params).toContain("user-1");
    expect(query.sql).not.toContain('"hiring_unit_odc_member"');
    expect(query.sql).not.toContain('"department_odc_member"');
    expect(query.sql).toContain('"organization_role"."role" = "member"."role"');
    expect(query.sql).toContain('"resume_source_odc_member"."job_series" is null');
    expect(query.sql).toContain(
      '"resume_source_odc_member"."job_series" = "job_description"."job_series"',
    );
    expect(query.sql).toContain('"resume_source_odc_member"."service_unit" is null');
    expect(query.sql).toContain(
      '"resume_source_odc_member"."service_unit" = "job_description"."service_unit"',
    );
    expect(query.sql).toContain('"studio_interview"."ai_review_approval_status" =');
    expect(query.sql).toContain('"studio_interview_odc_assignment"."user_id" =');
    expect(query.params).toContain("approved");
    expect(query.params).not.toContain("ai_review");
  });

  it("keeps explicit AI review approvers able to read the workspace review stage", () => {
    const condition = buildResumeVisibilityCondition({
      actor: { organizationId: "organization-1", userId: "user-1" },
      aiReviewOrganizationId: "organization-1",
      odc: { departmentIds: [], hiringUnitIds: [] },
      recruiting: { kind: "none" },
    });
    if (!condition) {
      throw new Error("Expected an AI review approver visibility condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"studio_interview"."pipeline_stage" =');
    expect(query.params).toContain("ai_review");
    expect(query.params).toContain("organization-1");
  });
});
