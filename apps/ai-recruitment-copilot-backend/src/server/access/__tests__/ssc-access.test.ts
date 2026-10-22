import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSscCandidateVisibilityCondition,
  isSscCandidateVisible,
  findSscPublicCandidate,
  resolveSscAccessActor,
} from "../ssc-access";
import { buildResumeVisibilityCondition } from "../resume-visibility";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { drizzle: mockDrizzle } = await import("drizzle-orm/node-postgres");
  return { db: mockDrizzle.mock() };
});

describe.skipIf(!process.env.DATABASE_URL)("SSC current Offer and source access", () => {
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  const executor = drizzle({ client });
  const actor = { organizationId: "a", userId: "ssc" };

  beforeAll(async () => {
    await client.unsafe(`
      CREATE TEMP TABLE "user" (id text PRIMARY KEY, email text, banned boolean);
      CREATE TEMP TABLE member (id text PRIMARY KEY, organization_id text, user_id text, role text);
      CREATE TEMP TABLE organization_role (organization_id text, role text, is_ssc boolean);
      CREATE TEMP TABLE ssc_responsibility (id text, organization_id text, email text, resume_source_id text, workspace_role text);
      CREATE TEMP TABLE resume_source (id text, organization_id text);
      CREATE TEMP TABLE job_description (id text, organization_id text, resume_source_id text);
      CREATE TEMP TABLE studio_interview (id text PRIMARY KEY, organization_id text, job_description_id text);
      CREATE TEMP TABLE studio_offer_draft (id text PRIMARY KEY, organization_id text, interview_record_id text, version integer, status text, ssc_confirmation_status text);
      CREATE TEMP TABLE studio_interview_schedule (id text PRIMARY KEY, organization_id text, interview_record_id text);
      INSERT INTO studio_interview_schedule VALUES ('round','a','pending');
      INSERT INTO "user" VALUES ('ssc','Ssc@Example.com',false), ('pending','pending@example.com',false), ('blocked','blocked@example.com',false), ('regular','regular@example.com',false);
      INSERT INTO member VALUES ('m','a','ssc','ssc-01'), ('mb','b','ssc','ssc-01'), ('blocked','a','blocked','noAccess'), ('regular','a','regular','member');
      INSERT INTO organization_role VALUES ('a','ssc-01',true), ('b','ssc-01',true), ('a','member',false), ('a','noAccess',false);
      INSERT INTO resume_source VALUES ('source-a','a'), ('source-other','a'), ('source-b','b');
      INSERT INTO ssc_responsibility VALUES ('ra','a',' ssc@example.com ','source-a','ssc-01'), ('rp','a','pending@example.com',NULL,'ssc-01'), ('rn','a','blocked@example.com','source-a','ssc-01'), ('rb','b','ssc@example.com','source-b','ssc-01');
      INSERT INTO job_description VALUES ('jd-a','a','source-a'), ('jd-other','a','source-other'), ('jd-b','b','source-b');
      INSERT INTO studio_interview VALUES ('no-offer','a','jd-a'), ('pending','a','jd-a'), ('confirming','a','jd-a'), ('completed','a','jd-a'), ('legacy','a','jd-a'), ('cancelled','a','jd-a'), ('deleted-latest','a','jd-a'), ('wrong-source','a','jd-other'), ('wrong-workspace','b','jd-b'), ('no-jd','a',NULL), ('old-completed-new-pending','a','jd-a');
      INSERT INTO studio_offer_draft VALUES
        ('op','a','pending',1,'draft','pending'),
        ('oc','a','confirming',1,'draft','confirming'),
        ('od','a','completed',1,'accepted','completed'),
        ('ol','a','legacy',1,'draft',NULL),
        ('ox','a','cancelled',1,'expired','completed'),
        ('od1','a','deleted-latest',1,'draft','completed'),
        ('od2','a','deleted-latest',2,'deleted','pending'),
        ('ow','a','wrong-source',1,'draft','pending'),
        ('ob','b','wrong-workspace',1,'draft','pending'),
        ('on','a','no-jd',1,'draft','pending'),
        ('ov1','a','old-completed-new-pending',1,'superseded','completed'),
        ('ov2','a','old-completed-new-pending',2,'draft','pending');
      ALTER TABLE ssc_responsibility ADD COLUMN telegram text NOT NULL DEFAULT '';
      ALTER TABLE ssc_responsibility ADD COLUMN service_unit text;
      ALTER TABLE ssc_responsibility ADD COLUMN department_id text;
      ALTER TABLE job_description ADD COLUMN service_unit text;
      ALTER TABLE job_description ADD COLUMN department_id text;
      ALTER TABLE organization_role ADD COLUMN is_odc boolean NOT NULL DEFAULT false;
      ALTER TABLE "user" ADD COLUMN telegram text;
      ALTER TABLE "user" ADD COLUMN telegram_bound_username text;
      ALTER TABLE "user" ADD COLUMN telegram_chat_id text;
      CREATE TEMP TABLE ssc_telegram_identity (user_id text, chat_id text, username text);
      CREATE TEMP TABLE telegram_recipient_binding (chat_id text, username text);
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  async function visible() {
    const query = new PgDialect().sqlToQuery(buildSscCandidateVisibilityCondition(actor));
    const rows = await client.unsafe(
      `SELECT id FROM studio_interview WHERE ${query.sql} ORDER BY id`,
      query.params as string[],
    );
    return rows.map((row) => row.id);
  }

  async function rolledBack(run: () => Promise<void>) {
    await client.unsafe("BEGIN");
    try {
      await run();
    } finally {
      await client.unsafe("ROLLBACK");
    }
  }

  it("shows pending before receipt and retains confirming/completed on the current source", async () => {
    expect(await visible()).toEqual([
      "completed",
      "confirming",
      "old-completed-new-pending",
      "pending",
    ]);
  });

  it("grants blank-email SSC only through its pinned, currently verified TG identity", async () => {
    await rolledBack(async () => {
      await client.unsafe(
        "UPDATE ssc_responsibility SET email='',telegram='@ssc_verified' WHERE id='ra'",
      );
      await client.unsafe(
        "INSERT INTO ssc_telegram_identity VALUES ('ssc','123456789','ssc_verified')",
      );
      expect(await visible()).toEqual([]);
      await client.unsafe(
        "INSERT INTO telegram_recipient_binding VALUES ('123456789','ssc_verified')",
      );
      expect(await visible()).toEqual([
        "completed",
        "confirming",
        "old-completed-new-pending",
        "pending",
      ]);
      await client.unsafe("UPDATE telegram_recipient_binding SET chat_id='999999999'");
      expect(await visible()).toEqual([]);
    });
  });

  it("does not let a pinned handle override a source assigned to another registered email", async () => {
    await rolledBack(async () => {
      await client.unsafe(
        "UPDATE ssc_responsibility SET email='regular@example.com',telegram='@ssc_verified' WHERE id='ra'",
      );
      await client.unsafe(
        "INSERT INTO ssc_telegram_identity VALUES ('ssc','123456789','ssc_verified')",
      );
      await client.unsafe(
        "INSERT INTO telegram_recipient_binding VALUES ('123456789','ssc_verified')",
      );
      expect(await visible()).toEqual([]);
    });
  });

  it("does not let recruiting-all or AI approval bypass the SSC gate", async () => {
    const condition = buildResumeVisibilityCondition({
      aiReviewOrganizationId: "a",
      odc: { departmentIds: [], hiringUnitIds: [] },
      recruiting: { kind: "all" },
      sscActor: actor,
    });
    if (!condition) {
      throw new Error("SSC must retain its source and current Offer restriction");
    }
    const query = new PgDialect().sqlToQuery(condition);
    const rows = await client.unsafe(
      `SELECT id FROM studio_interview WHERE ${query.sql} ORDER BY id`,
      query.params as string[],
    );
    expect(rows.map((row) => row.id)).toEqual([
      "completed",
      "confirming",
      "old-completed-new-pending",
      "pending",
    ]);
  });

  it("keeps SSC classification when every responsibility is removed but grants no records", async () => {
    await rolledBack(async () => {
      await client.unsafe("DELETE FROM ssc_responsibility WHERE organization_id='a'");
      expect(await resolveSscAccessActor({ ...actor, currentRole: "ssc-01" }, executor)).toEqual(
        actor,
      );
      expect(await visible()).toEqual([]);
    });
  });

  it("keeps the strict SSC gate when switching between SSC roles without matching assignments", async () => {
    await rolledBack(async () => {
      await client.unsafe(
        "INSERT INTO organization_role (organization_id, role, is_ssc) VALUES ('a','ssc-02',true)",
      );
      await client.unsafe(
        "UPDATE member SET role='ssc-02' WHERE organization_id='a' AND user_id='ssc'",
      );
      expect(await resolveSscAccessActor({ ...actor, currentRole: "ssc-02" }, executor)).toEqual(
        actor,
      );
      expect(await visible()).toEqual([]);
      await client.unsafe(
        "UPDATE ssc_responsibility SET workspace_role='ssc-02' WHERE organization_id='a'",
      );
      expect(await visible()).toEqual([
        "completed",
        "confirming",
        "old-completed-new-pending",
        "pending",
      ]);
    });
  });

  it.each(["ssc-01,member", "member, ssc-01", "ssc-01,", " ssc-01 ", "\tssc-01\n"])(
    "classifies mixed role %s as SSC and fails closed even without assignments",
    async (role) => {
      await rolledBack(async () => {
        await client.unsafe("DELETE FROM ssc_responsibility WHERE organization_id='a'");
        await client.unsafe(
          "UPDATE member SET role=$1 WHERE organization_id='a' AND user_id='ssc'",
          [role],
        );
        expect(await resolveSscAccessActor({ ...actor, currentRole: role }, executor)).toEqual(
          actor,
        );
        expect(await visible()).toEqual([]);
      });
    },
  );

  it.each([
    "DELETE FROM member WHERE organization_id='a' AND user_id='ssc'",
    "UPDATE member SET role='member' WHERE organization_id='a' AND user_id='ssc'",
    "UPDATE organization_role SET is_ssc=false WHERE organization_id='a'",
    "UPDATE \"user\" SET banned=true WHERE id='ssc'",
    "UPDATE ssc_responsibility SET resume_source_id=NULL WHERE organization_id='a'",
    "UPDATE ssc_responsibility SET workspace_role=NULL WHERE organization_id='a'",
    "UPDATE ssc_responsibility SET email='' WHERE organization_id='a'",
  ])("removes access immediately after %s", async (mutation) => {
    await rolledBack(async () => {
      await client.unsafe(mutation);
      expect(await visible()).toEqual([]);
    });
  });

  it("rejects a draft attached to another candidate even under an allowed parent URL", async () => {
    expect(
      await isSscCandidateVisible({ actor, candidateId: "pending", draftId: "ow" }, executor),
    ).toBe(false);
    expect(
      await isSscCandidateVisible({ actor, candidateId: "pending", draftId: "op" }, executor),
    ).toBe(true);
  });

  it("fails closed when multiple accounts share the normalized SSC email", async () => {
    await rolledBack(async () => {
      await client.unsafe(
        "INSERT INTO \"user\" (id, email, banned) VALUES ('collision','ssc@example.com',false)",
      );
      expect(await visible()).toEqual([]);
    });
  });

  it.each(["pending", "blocked"])(
    "recognizes known SSC pre-entry identity %s without usable membership",
    async (userId) => {
      expect(await resolveSscAccessActor({ organizationId: "a", userId }, executor)).toEqual({
        organizationId: "a",
        userId,
      });
      expect(
        await isSscCandidateVisible(
          { actor: { organizationId: "a", userId }, candidateId: "pending" },
          executor,
        ),
      ).toBe(false);
    },
  );

  it("does not change ordinary member or unrelated external-review identity", async () => {
    expect(
      await resolveSscAccessActor(
        { currentRole: "member", organizationId: "a", userId: "regular" },
        executor,
      ),
    ).toBeNull();
    expect(
      await resolveSscAccessActor({ organizationId: "unrelated", userId: "pending" }, executor),
    ).toBeNull();
  });

  it("resolves public candidate and round links to their actual workspace", async () => {
    expect(await findSscPublicCandidate({ id: "pending" }, executor)).toEqual({
      candidateId: "pending",
      organizationId: "a",
    });
    expect(await findSscPublicCandidate({ id: "round", round: true }, executor)).toEqual({
      candidateId: "pending",
      organizationId: "a",
    });
    expect(await findSscPublicCandidate({ id: "missing", round: true }, executor)).toBeNull();
  });
});
