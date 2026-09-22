import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDatabase } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { listMemberOdcScopes, updateMemberOdcScope } from "./dao";
import { resolveOdcAccessScope } from "../../../../../../utils/hiring-unit-scope";
import { buildResumeVisibilityCondition } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { listAiReviewNotificationRecipients } from "../../../../../ai-review/dao";
import { listResumeSources } from "../../../../../resume-sources/dao";
import {
  createResumeSourceOdcAssignments,
  deleteResumeSourceOdcAssignment,
  queryPaginatedResumeSourceOdcAssignments,
  replaceResumeSourceOdcMembers,
  updateResumeSourceOdcAssignment,
} from "../../../../../resume-sources/routes/odc/dao";
import { provisionPreRegisteredUser } from "../../../../../pre-registrations/provisioning";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(process.env.DATABASE_URL ?? "", { connect_timeout: 5, max: 1 });
  return { closeDatabase: () => client.end(), db: drizzle({ client }) };
});

async function storedMember(memberId = "m") {
  const { records } = await listMemberOdcScopes("org");
  const result = records.find((row) => row.memberId === memberId);
  if (!result) {
    throw new Error("Expected workspace member");
  }
  return result;
}

async function sourceIds(organizationId = "org") {
  const scope = await resolveOdcAccessScope({ actorUserId: "u", organizationId });
  return scope.resumeSourceIds?.toSorted();
}

const setAll = () => updateMemberOdcScope("org", "m", { odcAssignments: [], odcScopeMode: "all" });

// All queried tables are session-local; no application tables or migrations are modified.
describe.skipIf(!process.env.DATABASE_URL)(
  "member ODC scope with temporary PostgreSQL tables",
  () => {
    beforeAll(async () => {
      await db.execute(
        sql.raw(`
      CREATE TEMP TABLE organization (id text PRIMARY KEY, slug text);
      CREATE TEMP TABLE "user" (id text PRIMARY KEY, name text, email text, image text, telegram text, telegram_bound_username text, telegram_chat_id text, banned boolean DEFAULT false, updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE member (id text PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, role text, created_at timestamptz DEFAULT now(), invite_link_id text, is_interviewer boolean DEFAULT false, UNIQUE(user_id, organization_id));
      CREATE TEMP TABLE organization_role (id text, organization_id text, role text, is_odc boolean, permission text);
      CREATE TEMP TABLE resume_source (id text PRIMARY KEY, organization_id text, name text, description text, created_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE resume_source_odc_member (organization_id text, member_id text, resume_source_id text, job_series text, service_unit text, can_approve_ai_review boolean DEFAULT false, created_at timestamptz DEFAULT now(), PRIMARY KEY(resume_source_id, member_id));
      CREATE TEMP TABLE hiring_unit (id text, organization_id text, resume_source_id text);
      CREATE TEMP TABLE department (id text, name text, organization_id text, hiring_unit_id text);
      CREATE TEMP TABLE job_description (id text, organization_id text, resume_source_id text, department_id text, hiring_unit_id text, job_series text, service_unit text);
      CREATE TEMP TABLE studio_interview (id text, organization_id text, job_description_id text, created_by text, pipeline_stage text, ai_review_approval_status text, ai_review_assigned_odc_user_id text);
      CREATE TEMP TABLE studio_interview_odc_assignment (interview_record_id text, user_id text);
      CREATE TEMP TABLE odc_department_responsibility (organization_id text, member_id text, resume_source_id text, department_id text);
      CREATE TEMP TABLE platform_pre_registration (id text, email text, display_name text, telegram text, workspace_slug text, workspace_role text, odc_assignments jsonb DEFAULT '[]', recruiting_group_names text[] DEFAULT '{}', recruiting_role text DEFAULT 'hr', direct_manager_email text);
      CREATE TEMP TABLE member_reporting_line (organization_id text, member_id text, direct_manager_id text);
    `),
      );
      const migration = readFileSync(
        new URL(
          "../../../../../../../../../../../ai-recruitment-copilot/drizzle/20260921170000_member_odc_scope/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      );
      await db.execute(sql.raw(migration));
    });
    afterAll(async () => {
      await closeDatabase();
    });
    beforeEach(async () => {
      await db.execute(
        sql.raw(`
      TRUNCATE pg_temp.organization, pg_temp."user", pg_temp.member, pg_temp.organization_role, pg_temp.resume_source, pg_temp.resume_source_odc_member, pg_temp.hiring_unit, pg_temp.department, pg_temp.job_description, pg_temp.studio_interview, pg_temp.studio_interview_odc_assignment, pg_temp.odc_department_responsibility, pg_temp.platform_pre_registration, pg_temp.member_reporting_line;
      INSERT INTO organization VALUES ('org', 'alpha'), ('other', 'beta');
      INSERT INTO "user" (id,name,email) VALUES ('u','ODC','odc@example.com'), ('n','Other','other@example.com');
      INSERT INTO member (id,organization_id,user_id,role) VALUES ('m','org','u','odc'), ('other-m','other','u','odc'), ('n','org','n','member');
      INSERT INTO organization_role VALUES ('role','org','odc',true,'{"page":["resumes"]}'), ('other-role','other','odc',true,'{"page":["resumes"]}');
      INSERT INTO resume_source (id,organization_id,name) VALUES ('a','org','来源 A'), ('b','org','来源 B'), ('foreign','other','其他来源');
      INSERT INTO resume_source_odc_member (organization_id,member_id,resume_source_id,job_series,service_unit) VALUES ('org','m','a','直属','悦达');
      INSERT INTO hiring_unit VALUES ('unit-a','org','a'), ('unit-b','org','b');
      INSERT INTO job_description VALUES ('jd','org','b','dept','unit-b','派驻','其他单位');
      INSERT INTO studio_interview VALUES
        ('assigned','org','jd','n','screening','approved','u'),
        ('unassigned','org','jd','n','screening','approved',null),
        ('pending','org','jd','n','ai_review','pending',null),
        ('foreign-candidate','other','jd','n','screening','approved','u');
    `),
      );
    });
    const selected = [{ jobSeries: "直属" as const, resumeSourceId: "a", serviceUnit: "悦达" }];

    it("defaults to selected, retains restrictions through all/selected switches, and reads future sources", async () => {
      await expect(storedMember()).resolves.toMatchObject({
        odcAssignments: selected,
        odcScopeMode: "selected",
      });
      await expect(sourceIds()).resolves.toEqual(["a"]);
      expect(await setAll()).toBe("updated");
      await expect(storedMember()).resolves.toMatchObject({ odcAssignments: selected });
      await db.execute(
        sql`INSERT INTO resume_source (id,organization_id,name) VALUES ('new','org','新来源')`,
      );
      await expect(sourceIds()).resolves.toEqual(["a", "b", "new"]);
      await expect(sourceIds("other")).resolves.toEqual([]);
      await updateMemberOdcScope("org", "m", {
        odcAssignments: selected,
        odcScopeMode: "selected",
      });
      await expect(sourceIds()).resolves.toEqual(["a"]);
      await expect(storedMember()).resolves.toMatchObject({ odcAssignments: selected });
    });

    it("rejects non-ODCs, cross-workspace members and foreign sources atomically", async () => {
      expect(
        await updateMemberOdcScope("org", "other-m", { odcAssignments: [], odcScopeMode: "all" }),
      ).toBe("not_found");
      expect(
        await updateMemberOdcScope("org", "n", { odcAssignments: [], odcScopeMode: "all" }),
      ).toBe("not_odc");
      expect(
        await updateMemberOdcScope("org", "m", {
          odcAssignments: [{ ...selected[0], resumeSourceId: "foreign" }],
          odcScopeMode: "selected",
        }),
      ).toBe("invalid_source");
      await expect(storedMember()).resolves.toMatchObject({ odcAssignments: selected });
    });

    it("revokes all-source access when the ODC role is removed without deleting the saved mode", async () => {
      await setAll();
      await db.execute(sql`UPDATE member SET role = 'member' WHERE id = 'm'`);
      await expect(sourceIds()).resolves.toEqual([]);
      const sources = await listResumeSources("org");
      expect(sources[0].odcMembers).toEqual([]);
      await db.execute(sql`UPDATE member SET role = 'odc' WHERE id = 'm'`);
      await expect(sourceIds()).resolves.toEqual(["a", "b"]);
    });

    it("shows global ODCs once per source and prevents source-side removal or overrides", async () => {
      await setAll();
      for (const source of await listResumeSources("org")) {
        expect(source.odcMembers).toHaveLength(1);
        expect(source.odcMembers[0]).toMatchObject({
          jobSeries: null,
          memberId: "m",
          odcScopeMode: "all",
          serviceUnit: null,
        });
      }
      const page = await queryPaginatedResumeSourceOdcAssignments({
        organizationId: "org",
        resumeSourceId: "b",
      });
      expect(page.total).toBe(1);
      expect(page.assignedMemberIds).toEqual(["m"]);
      const target = { memberId: "m", organizationId: "org", resumeSourceId: "a" };
      await expect(deleteResumeSourceOdcAssignment(target)).rejects.toThrow("全部部门/中心");
      await expect(
        updateResumeSourceOdcAssignment({ ...target, input: { jobSeries: null } }),
      ).rejects.toThrow("全部部门/中心");
      await expect(
        createResumeSourceOdcAssignments({ ...target, assignments: [{ memberId: "m" }] }),
      ).rejects.toThrow("全部部门/中心");
      await replaceResumeSourceOdcMembers({ assignments: [], id: "a", organizationId: "org" });
      await expect(storedMember()).resolves.toMatchObject({ odcAssignments: selected });
    });

    it("makes all-source ODCs eligible recipients but still requires approval and explicit assignment", async () => {
      expect(
        await listAiReviewNotificationRecipients({ candidateId: "pending", organizationId: "org" }),
      ).toEqual([]);
      await setAll();
      const recipients = await listAiReviewNotificationRecipients({
        candidateId: "pending",
        organizationId: "org",
      });
      expect(recipients.map((row) => row.userId)).toEqual(["u"]);
      expect(recipients[0].resumeSourceNames).toEqual(["全部部门/中心"]);
      const odc = await resolveOdcAccessScope({ actorUserId: "u", organizationId: "org" });
      const condition = buildResumeVisibilityCondition({
        actor: { organizationId: "org", userId: "u" },
        odc,
        odcActor: { organizationId: "org", userId: "u" },
        recruiting: { kind: "all" },
      });
      const visible = await db.execute(sql`SELECT id FROM studio_interview WHERE ${condition}`);
      expect(visible.map((row) => row.id)).toEqual(["assigned"]);
      await db.execute(
        sql`UPDATE organization_role SET permission = '{}' WHERE organization_id = 'org'`,
      );
      expect(
        await listAiReviewNotificationRecipients({ candidateId: "pending", organizationId: "org" }),
      ).toEqual([]);
    });

    it("initializes pre-registered all scope once and never overwrites a later member edit on login", async () => {
      await db.execute(
        sql`INSERT INTO "user" (id,name,email) VALUES ('new-user','New','new@example.com')`,
      );
      await db.execute(
        sql`INSERT INTO platform_pre_registration (id,email,display_name,telegram,workspace_slug,workspace_role,odc_scope_mode) VALUES ('pre','new@example.com','New','@new','alpha','odc','all')`,
      );
      await provisionPreRegisteredUser({ email: "new@example.com", userId: "new-user" });
      const { records } = await listMemberOdcScopes("org");
      const created = records.find((row) => row.email === "new@example.com");
      if (!created) {
        throw new Error("Expected provisioned member");
      }
      expect(created.odcScopeMode).toBe("all");
      await updateMemberOdcScope("org", created.memberId, {
        odcAssignments: selected,
        odcScopeMode: "selected",
      });
      await provisionPreRegisteredUser({ email: "new@example.com", userId: "new-user" });
      await expect(storedMember(created.memberId)).resolves.toMatchObject({
        odcAssignments: selected,
        odcScopeMode: "selected",
      });
    });
  },
);
