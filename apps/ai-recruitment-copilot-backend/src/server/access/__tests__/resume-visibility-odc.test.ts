import { readFileSync } from "node:fs";
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
      CREATE TEMP TABLE "user" (id text PRIMARY KEY);
      INSERT INTO "user" VALUES ('a'), ('b'), ('c'), ('r');
      CREATE TEMP TABLE member (id text, organization_id text, user_id text, role text);
      CREATE TEMP TABLE organization_role (organization_id text, role text, is_odc boolean);
      CREATE TEMP TABLE resume_source_odc_member (organization_id text, member_id text, resume_source_id text, job_series text, service_unit text);
      CREATE TEMP TABLE job_description (id text, organization_id text, resume_source_id text, job_series text, service_unit text);
      CREATE TEMP TABLE studio_interview (id text PRIMARY KEY, organization_id text, job_description_id text, created_by text, pipeline_stage text, ai_review_approval_status text, ai_review_assigned_odc_user_id text REFERENCES "user"(id) ON DELETE SET NULL);
      INSERT INTO organization_role VALUES ('org', 'odc', true), ('org', 'recruiter', false);
      INSERT INTO member VALUES ('a', 'org', 'a', 'odc'), ('b', 'org', 'b', 'odc'), ('c', 'org', 'c', 'odc'), ('r', 'org', 'r', 'recruiter');
      INSERT INTO resume_source_odc_member VALUES ('org', 'a', 'source', NULL, NULL), ('org', 'b', 'source', NULL, NULL), ('org', 'c', 'source', NULL, NULL);
      INSERT INTO job_description VALUES ('jd', 'org', 'source', NULL, NULL), ('outside-jd', 'org', 'other-source', NULL, NULL);
      INSERT INTO studio_interview VALUES
        ('assigned-many', 'org', 'jd', 'b', 'screening', 'approved', 'a'),
        ('assigned-a', 'org', 'jd', 'b', 'screening', 'approved', 'a'),
        ('later-stage', 'org', 'jd', 'b', 'human_interview', 'approved', 'a'),
        ('missing-recipient', 'org', 'jd', 'b', 'screening', 'approved', NULL),
        ('pending', 'org', 'jd', 'b', 'ai_review', 'pending', NULL),
        ('outside-offer', 'org', 'outside-jd', 'b', 'offer', 'pending', NULL),
        ('outside-assigned', 'org', 'outside-jd', 'b', 'screening', 'approved', 'b'),
        ('outside-review', 'org', 'outside-jd', 'r', 'ai_review', 'pending', NULL);
    `);
    // Exercise the additive migration without altering persistent tables or functions.
    const migration = readFileSync(
      new URL(
        "../../../../../ai-recruitment-copilot/drizzle/20260916120000_multiple_ai_review_odcs/migration.sql",
        import.meta.url,
      ),
      "utf-8",
    )
      .replace(
        'CREATE TABLE "studio_interview_odc_assignment"',
        'CREATE TEMP TABLE "studio_interview_odc_assignment"',
      )
      .replace(
        'CREATE FUNCTION "clear_legacy_ai_review_odc_assignments"',
        'CREATE FUNCTION pg_temp."clear_legacy_ai_review_odc_assignments"',
      )
      .replace(
        'EXECUTE FUNCTION "clear_legacy_ai_review_odc_assignments"',
        'EXECUTE FUNCTION pg_temp."clear_legacy_ai_review_odc_assignments"',
      );
    await client.unsafe(migration);
    await client.unsafe(
      "INSERT INTO studio_interview_odc_assignment VALUES ('assigned-many', 'b')",
    );
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
    expect(await visible("a")).toEqual(["assigned-a", "assigned-many", "later-stage", "pending"]);
  });
  it("denies another ODC on the same source even if they created the record or share the recruiting group", async () => {
    expect(await visible("b")).toEqual(["assigned-many", "pending"]);
  });
  it("does not let inherited unrestricted recruiting access bypass assignment", async () => {
    expect(await visible("b", true)).toEqual(["assigned-many", "outside-review", "pending"]);
  });
  it("allows cross-source review for approvers but never a cross-source offer or assignment", async () => {
    expect(await visible("b", false, true)).toEqual(["assigned-many", "outside-review", "pending"]);
  });
  it("does not grant unselected ODCs access to a multi-assigned candidate", async () => {
    expect(await visible("c")).toEqual(["pending"]);
  });
  it("reads historical assignments directly from the retained legacy column", async () => {
    const rows = await client.unsafe(
      "SELECT ai_review_assigned_odc_user_id AS user_id FROM studio_interview WHERE id = 'assigned-a'",
    );
    expect(rows.map((row) => row.user_id)).toEqual(["a"]);
    expect(
      await client.unsafe(
        "SELECT * FROM studio_interview_odc_assignment WHERE interview_record_id IN ('assigned-a', 'missing-recipient')",
      ),
    ).toHaveLength(0);
  });
  async function withRollback(run: () => Promise<void>) {
    await client.unsafe("BEGIN");
    try {
      await run();
    } finally {
      await client.unsafe("ROLLBACK");
    }
  }

  it("recognizes approvals written by the old version after migration", async () => {
    await withRollback(async () => {
      await client.unsafe(
        "INSERT INTO studio_interview VALUES ('legacy-new', 'org', 'jd', 'b', 'screening', 'approved', 'c')",
      );
      expect(await visible("c")).toContain("legacy-new");
      expect(await visible("a")).not.toContain("legacy-new");
    });
  });

  it.each(["a", "c"])(
    "clears stale multi-assignments when the old version approves to %s",
    async (recipient) => {
      await withRollback(async () => {
        await client.unsafe(
          "UPDATE studio_interview SET ai_review_assigned_odc_user_id = $1 WHERE id = 'assigned-many'",
          [recipient],
        );
        expect(await visible(recipient)).toContain("assigned-many");
        expect(await visible("b")).not.toContain("assigned-many");
        expect(
          await client.unsafe(
            "SELECT * FROM studio_interview_odc_assignment WHERE interview_record_id = 'assigned-many'",
          ),
        ).toHaveLength(0);
      });
    },
  );

  it("clears assignments when the old version reactivates a candidate into AI review", async () => {
    await withRollback(async () => {
      await client.unsafe(
        "UPDATE studio_interview SET ai_review_assigned_odc_user_id = NULL, ai_review_approval_status = 'pending', pipeline_stage = 'ai_review' WHERE id = 'assigned-many'",
      );
      expect(
        await client.unsafe(
          "SELECT * FROM studio_interview_odc_assignment WHERE interview_record_id = 'assigned-many'",
        ),
      ).toHaveLength(0);
    });
  });

  it("stores new assignments only in the relation table and clears the stale legacy assignee", async () => {
    await withRollback(async () => {
      await client.unsafe(
        "UPDATE studio_interview SET ai_review_assigned_odc_user_id = NULL WHERE id = 'assigned-many'",
      );
      await client.unsafe(
        "DELETE FROM studio_interview_odc_assignment WHERE interview_record_id = 'assigned-many'",
      );
      await client.unsafe(
        "INSERT INTO studio_interview_odc_assignment VALUES ('assigned-many', 'b'), ('assigned-many', 'c')",
      );
      expect(await visible("b")).toContain("assigned-many");
      expect(await visible("c")).toContain("assigned-many");
      expect(await visible("a")).not.toContain("assigned-many");
      const legacyRows = await client.unsafe(
        "SELECT id FROM studio_interview WHERE id = 'assigned-many' AND ai_review_assigned_odc_user_id IS NOT NULL",
      );
      expect(legacyRows).toHaveLength(0);
    });
  });

  it("preserves the other assignees if the legacy primary user is deleted", async () => {
    await withRollback(async () => {
      await client.unsafe(`DELETE FROM "user" WHERE id = 'a'`);
      expect(await visible("b")).toContain("assigned-many");
      const rows = await client.unsafe(
        "SELECT ai_review_assigned_odc_user_id AS user_id FROM studio_interview WHERE id = 'assigned-many'",
      );
      expect(rows[0]?.user_id).toBeNull();
    });
  });

  it("preserves normal recruiting visibility for non-ODC roles", async () => {
    expect(await visible("r")).toEqual([
      "assigned-a",
      "assigned-many",
      "later-stage",
      "missing-recipient",
      "outside-assigned",
      "outside-offer",
      "pending",
    ]);
  });
});
