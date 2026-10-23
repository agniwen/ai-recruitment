import { saveResumeProtectionDays, upsertGlobalConfig } from "../../../global-config/dao";
import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { globalConfig, studioInterview } from "@arc/db-schema/schema";
import {
  admitResumeRecord,
  importVerifiedResumeProtection,
  findResumeProtectionConflict,
  loadResumeProtectionDetails,
} from "./index";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { PGlite: Client } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  return { db: drizzle({ client: new Client() }) };
});

const client = db.$client as unknown as PGlite;
const now = new Date("2026-10-01T02:00:00Z");
const admit = (id: string, workspace = "w", allowStart = true) =>
  db.transaction((tx) => admitResumeRecord(tx, id, workspace, allowStart));
async function seed(id: string, owner: string, workspace = "w", hash = "hash", unit = "unit-a") {
  await client.query(
    `INSERT INTO studio_interview
    (id,organization_id,created_by,candidate_name,candidate_email,candidate_phone,resume_content_hash,resume_profile,
     resume_parse_status,resume_review_status,pipeline_stage,outcome,resume_admission_status,hiring_unit_id)
    VALUES ($1,$2,$3,'陈安','c@example.com','13800000000',$4,'{"name":"陈安","email":"c@example.com","phone":"13800000000"}',
    'ready','idle','ai_review','in_pipeline','pending',$5)`,
    [id, workspace, owner, hash, unit],
  );
}
async function cycles() {
  const result = await client.query<{ duration_days: number; expires_at: string }>(
    "SELECT * FROM resume_protection_cycle ORDER BY starts_at",
  );
  return result.rows;
}

const wideTable = (table: typeof studioInterview | typeof globalConfig, excluded: string[]) => {
  const config = getTableConfig(table);
  const columns = config.columns
    .filter((column) => !excluded.includes(column.name))
    .map(
      (column) =>
        `"${column.name}" ${column.getSQLType()}${column.name === "id" ? " PRIMARY KEY" : ""}`,
    );
  return `CREATE TABLE "${config.name}" (${columns.join(",")});`;
};

describe("transactional recommendation protection", () => {
  beforeAll(async () => {
    // Build the current wide record table without the new columns, then apply
    // the actual production migration to an isolated in-memory PostgreSQL.
    await client.exec(`
      CREATE TABLE organization (id text PRIMARY KEY);
      INSERT INTO organization VALUES ('w'),('other');
      CREATE TABLE "user" (id text PRIMARY KEY, name text);
      INSERT INTO "user" VALUES ('a','王晓'),('b','李明');
      CREATE TABLE hiring_unit (id text PRIMARY KEY, organization_id text, name text);
      INSERT INTO hiring_unit VALUES ('unit-a','w','技术中心'),('unit-b','w','海外业务中心'),('other-unit','other','其他组织');
      CREATE TABLE job_description (id text PRIMARY KEY, organization_id text, hiring_unit_id text, name text);
      ${wideTable(studioInterview, ["resume_admission_checked_at", "resume_admission_status", "resume_protection", "resume_protection_cycle_id"])}
      ${wideTable(globalConfig, ["resume_protection_days", "resume_protection_updated_at", "resume_protection_updated_by"])}
      CREATE TABLE studio_interview_schedule (id text, interview_record_id text, organization_id text);
      CREATE TABLE studio_human_interview_round (id text, interview_record_id text, organization_id text);
      CREATE TABLE studio_offer_draft (id text, interview_record_id text, organization_id text);
    `);
    await client.exec(
      await readFile(
        new URL(
          "../../../../../../../../../ai-recruitment-copilot/drizzle/20261022120000_resume_recommendation_protection/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    await client.exec(
      "TRUNCATE studio_interview, resume_protection_cycle, resume_protection_config_change CASCADE; DELETE FROM global_config; INSERT INTO global_config (id,organization_id,company_name,company_context,opening_instructions,closing_instructions,job_code_prefix,updated_at) VALUES ('config','w','','','','','AUR','2026-10-01T02:00:00Z');",
    );
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => client.close());

  it("blocks another person across organizations and preserves the owner and original expiry", async () => {
    await seed("a1", "a");
    expect(await admit("a1")).toBe("accepted");
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));
    await seed("a2", "a", "w", "new-version", "unit-b");
    expect(await admit("a2")).toBe("accepted");
    await seed("b1", "b", "w", "third-version", "unit-b");
    expect(await admit("b1")).toBe("protected");
    expect(await cycles()).toHaveLength(1);
    const details = await loadResumeProtectionDetails("b1", "w");
    expect(details?.protection).toMatchObject({
      expiresAt: "2026-10-16T02:00:00.000Z",
      hiringUnitNames: ["技术中心", "海外业务中心"],
      ownerUserId: "a",
      startsAt: now.toISOString(),
    });
    await client.exec("UPDATE studio_interview SET pipeline_stage='human_interview' WHERE id='a1'");
    const progressedDetails = await loadResumeProtectionDetails("b1", "w");
    expect(progressedDetails?.recommendations[0].pipelineStage).toBe("human_interview");
    expect(await loadResumeProtectionDetails("b1", "other")).toBeNull();
  });
  it("uses the new configuration only for new cycles and permits the expiry boundary", async () => {
    await seed("a1", "a");
    await admit("a1");
    await client.exec("UPDATE global_config SET resume_protection_days=7");
    vi.setSystemTime(new Date("2026-10-16T01:59:59.999Z"));
    await seed("boundary", "b");
    expect(await admit("boundary")).toBe("protected");
    vi.setSystemTime(new Date("2026-10-16T02:00:00Z"));
    await seed("b1", "b");
    expect(await admit("b1")).toBe("accepted");
    const rows = await cycles();
    expect(rows).toHaveLength(2);
    expect(rows[0].duration_days).toBe(15);
    expect(rows[1].duration_days).toBe(7);
    expect(new Date(String(rows[1].expires_at)).toISOString()).toBe("2026-10-23T02:00:00.000Z");
  });
  it("keeps protection after deleting the original recommendation and never auto-admits blocked edits", async () => {
    await seed("a1", "a");
    await admit("a1");
    await seed("b1", "b");
    await admit("b1");
    await client.exec("DELETE FROM studio_interview WHERE id='a1'");
    await seed("b2", "b");
    expect(await admit("b2")).toBe("protected");
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    expect(await admit("b1")).toBe("protected");
    const deletedDetails = await loadResumeProtectionDetails("b1", "w");
    expect(deletedDetails?.recommendations[0].pipelineStage).toBeNull();
  });
  it("does not start protection for collection-only or unparsed records, and isolates workspaces", async () => {
    await seed("pool", "a");
    expect(await admit("pool", "w", false)).toBe("pending");
    expect(await cycles()).toHaveLength(0);
    await seed("a1", "a");
    await admit("a1");
    await seed("other", "b", "other", "hash", "other-unit");
    expect(await admit("other", "other")).toBe("accepted");
    await seed("unparsed", "b");
    await client.exec(
      "UPDATE studio_interview SET resume_profile=NULL, resume_parse_status='queued' WHERE id='unparsed'",
    );
    expect(await admit("unparsed")).toBe("pending");
  });
  it("rejects bypasses at the database boundary, while allowing normal preview edits and closing", async () => {
    await seed("a1", "a");
    await admit("a1");
    await seed("b1", "b");
    await admit("b1");
    await expect(
      client.exec("UPDATE studio_interview SET pipeline_stage='screening' WHERE id='b1'"),
    ).rejects.toThrow();
    await expect(
      client.exec("UPDATE studio_interview SET resume_review='{}' WHERE id='b1'"),
    ).rejects.toThrow();
    for (const table of [
      "studio_interview_schedule",
      "studio_human_interview_round",
      "studio_offer_draft",
    ]) {
      await expect(client.exec(`INSERT INTO ${table} VALUES ('x','b1','w')`)).rejects.toThrow();
    }
    await client.exec(
      "UPDATE studio_interview SET candidate_name='陈安（备注）',pipeline_stage='closed',outcome='archived' WHERE id='b1'",
    );
    expect(await admit("b1")).toBe("protected");
  });
  it("makes repeated admission idempotent and leaves only one owner for competing submissions", async () => {
    await seed("a1", "a");
    await seed("b1", "b");
    const results = await Promise.all([admit("a1"), admit("b1")]);
    expect(results.toSorted()).toEqual(["accepted", "protected"]);
    await admit("a1");
    expect(await cycles()).toHaveLength(1);
    const recommendations = await client.query("SELECT * FROM resume_protection_recommendation");
    expect(recommendations.rows).toHaveLength(1);
  });
  it("does not rely on the uploader-filtered or asynchronous semantic search", async () => {
    await seed("a1", "a");
    await admit("a1");
    expect(
      await findResumeProtectionConflict({
        identity: { contentHash: "hash", email: null, name: null, phone: null },
        organizationId: "w",
        userId: "a",
      }),
    ).toBeNull();
    const conflict = await findResumeProtectionConflict({
      identity: { contentHash: "hash", email: null, name: null, phone: null },
      organizationId: "w",
      userId: "b",
    });
    expect(conflict?.ownerUserId).toBe("a");
  });
  it("recognizes later resume versions even when only their file identity remains", async () => {
    await seed("a1", "a");
    await admit("a1");
    await seed("a2", "a", "w", "updated-hash");
    await admit("a2");
    await client.exec("DELETE FROM studio_interview WHERE id='a2'");
    const conflict = await findResumeProtectionConflict({
      identity: { contentHash: "updated-hash", email: null, name: null, phone: null },
      organizationId: "w",
      userId: "b",
    });
    expect(conflict?.ownerUserId).toBe("a");
  });
  it("imports verified historical dates without creating a new 15 days from migration time", async () => {
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));
    await seed("legacy", "a");
    await client.exec(
      "UPDATE studio_interview SET resume_admission_status='accepted' WHERE id='legacy'",
    );
    expect(await admit("legacy")).toBe("accepted");
    expect(await cycles()).toHaveLength(0);
    await db.transaction((tx) =>
      importVerifiedResumeProtection(tx, {
        durationDays: 15,
        organizationId: "w",
        recommendedAt: now,
        recordId: "legacy",
      }),
    );
    const rows = await cycles();
    expect(new Date(rows[0].expires_at).toISOString()).toBe("2026-10-16T02:00:00.000Z");
    await seed("b1", "b");
    expect(await admit("b1")).toBe("protected");
  });
  it("keeps explicit protection settings when the existing company autosave omits them", async () => {
    await seed("a1", "a");
    await admit("a1");
    const configured = await saveResumeProtectionDays("w", "b", 9);
    expect(configured.resumeProtectionDays).toBe(9);
    const updated = await upsertGlobalConfig(
      {
        closingInstructions: "结束",
        companyContext: "公司简介",
        companyName: "新名称",
        jobCodePrefix: "NEW",
        openingInstructions: "开场",
      },
      "a",
      "w",
    );
    expect(updated.resumeProtectionDays).toBe(9);
    const audit = await client.query<{ previous_days: number; days: number }>(
      "SELECT previous_days, days FROM resume_protection_config_change",
    );
    expect(audit.rows).toEqual([{ days: 9, previous_days: 15 }]);
    const existing = await cycles();
    expect(existing[0].duration_days).toBe(15);
  });
});
