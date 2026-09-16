import postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildResumeVisibilityCondition } from "../resume-visibility";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle.mock() };
});

// Temporary tables isolate these authorization checks from application data.
describe.skipIf(!process.env.DATABASE_URL)("ODC approval recipient visibility", () => {
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  beforeAll(async () => {
    await client.unsafe(`
      CREATE TEMP TABLE member (id text, organization_id text, user_id text, role text);
      CREATE TEMP TABLE organization_role (organization_id text, role text, is_odc boolean);
      CREATE TEMP TABLE resume_source_odc_member (organization_id text, member_id text, resume_source_id text, job_series text, service_unit text);
      CREATE TEMP TABLE job_description (id text, organization_id text, resume_source_id text, job_series text, service_unit text);
      CREATE TEMP TABLE studio_interview (id text, organization_id text, job_description_id text, created_by text, pipeline_stage text, ai_review_approval_status text, ai_review_assigned_odc_user_id text);
      INSERT INTO organization_role VALUES ('org', 'odc', true), ('org', 'recruiter', false);
      INSERT INTO member VALUES ('a', 'org', 'a', 'odc'), ('b', 'org', 'b', 'odc'), ('r', 'org', 'r', 'recruiter');
      INSERT INTO resume_source_odc_member VALUES ('org', 'a', 'source', NULL, NULL), ('org', 'b', 'source', NULL, NULL);
      INSERT INTO job_description VALUES ('jd', 'org', 'source', NULL, NULL), ('outside-jd', 'org', 'other-source', NULL, NULL);
      INSERT INTO studio_interview VALUES
        ('assigned-a', 'org', 'jd', 'b', 'screening', 'approved', 'a'),
        ('later-stage', 'org', 'jd', 'b', 'human_interview', 'approved', 'a'),
        ('missing-recipient', 'org', 'jd', 'b', 'screening', 'approved', NULL),
        ('pending', 'org', 'jd', 'b', 'ai_review', 'pending', NULL),
        ('outside-offer', 'org', 'outside-jd', 'b', 'offer', 'pending', NULL),
        ('outside-assigned', 'org', 'outside-jd', 'b', 'screening', 'approved', 'b'),
        ('outside-review', 'org', 'outside-jd', 'r', 'ai_review', 'pending', NULL);
    `);
  });
  afterAll(async () => {
    await client.end();
  });

  async function visible(userId: string, all = false, approve = false) {
    const condition = buildResumeVisibilityCondition({
      actor: { organizationId: "org", userId },
      ...(approve ? { aiReviewOrganizationId: "org" } : {}),
      odc: { departmentIds: [], hiringUnitIds: [], resumeSourceIds: ["source"] },
      odcActor: { organizationId: "org", userId },
      recruiting: all ? { kind: "all" } : { kind: "restricted", userIds: ["b"] },
    });
    if (!condition) {
      throw new Error("Expected authorization condition");
    }
    const query = new PgDialect().sqlToQuery(condition);
    const rows = await client.unsafe(
      `SELECT id FROM studio_interview WHERE ${query.sql} ORDER BY id`,
      query.params as string[],
    );
    return rows.map((row) => row.id);
  }

  it("allows the designated ODC through the shared source, including subsequent stages", async () => {
    expect(await visible("a")).toEqual(["assigned-a", "later-stage", "pending"]);
  });
  it("denies another ODC on the same source even if they created the record or share the recruiting group", async () => {
    expect(await visible("b")).toEqual(["pending"]);
  });
  it("does not let inherited unrestricted recruiting access bypass assignment", async () => {
    expect(await visible("b", true)).toEqual(["outside-review", "pending"]);
  });
  it("allows cross-source review for approvers but never a cross-source offer or assignment", async () => {
    expect(await visible("b", false, true)).toEqual(["outside-review", "pending"]);
  });
  it("preserves normal recruiting visibility for non-ODC roles", async () => {
    expect(await visible("r")).toEqual([
      "assigned-a",
      "later-stage",
      "missing-recipient",
      "outside-assigned",
      "outside-offer",
      "pending",
    ]);
  });
});
