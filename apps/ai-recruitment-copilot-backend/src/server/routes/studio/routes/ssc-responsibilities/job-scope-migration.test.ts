import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;
const migrationFile = new URL(
  "../../../../../../../ai-recruitment-copilot/drizzle/20261022190000_ssc_responsibility_job_scope/migration.sql",
  import.meta.url,
);
const migration = existsSync(migrationFile) ? readFileSync(migrationFile, "utf-8") : "SELECT 1";
const client = databaseUrl
  ? postgres(databaseUrl, { connect_timeout: 5, max: 1, onnotice: () => {}, prepare: false })
  : null;
const fixture = `
CREATE TEMP TABLE department (id text PRIMARY KEY, organization_id text NOT NULL, UNIQUE(organization_id,id)) ON COMMIT DROP;
CREATE TEMP TABLE ssc_responsibility (id text PRIMARY KEY, organization_id text NOT NULL, resume_source_id text, center_name text NOT NULL, email text NOT NULL, telegram text NOT NULL DEFAULT '', ssc_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z') ON COMMIT DROP;
CREATE UNIQUE INDEX ssc_responsibility_workspace_scope_identity_uq ON ssc_responsibility (organization_id, coalesce('source:'||resume_source_id,'name:'||lower(btrim(center_name))), lower(btrim(email)));
INSERT INTO department VALUES ('local','org'),('foreign','other');
INSERT INTO ssc_responsibility(id,organization_id,resume_source_id,center_name,email,ssc_name) VALUES ('legacy','org','source','Center','ssc@example.com','SSC');`;
afterAll(async () => {
  await client?.end();
});
describe.skipIf(!client || databaseUrl !== process.env.DATABASE_URL)(
  "SSC job-scope additive migration",
  () => {
    it("preserves legacy identity while defaulting both restrictions to unrestricted", async () => {
      await client?.begin(async (tx) => {
        await tx.unsafe(fixture).simple();
        const before = await tx`SELECT * FROM ssc_responsibility`;
        await tx.unsafe(migration).simple();
        const after = await tx`SELECT * FROM ssc_responsibility`;
        expect(after[0]).toEqual({ ...before[0], department_id: null, service_unit: null });
      });
    });
    it("distinguishes restrictions and normalizes service-unit duplicate identity", async () => {
      await client?.begin(async (tx) => {
        await tx.unsafe(fixture).simple();
        await tx.unsafe(migration).simple();
        await tx`INSERT INTO ssc_responsibility(id,organization_id,resume_source_id,center_name,email,ssc_name,service_unit,department_id) VALUES ('scoped','org','source','Center','ssc@example.com','SSC','Sinema','local')`;
        await expect(
          tx.savepoint(async (nested) => {
            await nested`INSERT INTO ssc_responsibility(id,organization_id,resume_source_id,center_name,email,ssc_name,service_unit,department_id) VALUES ('duplicate','org','source','Center','ssc@example.com','SSC',' sinema ','local')`;
          }),
        ).rejects.toMatchObject({ code: "23505" });
      });
    });
    it("rejects a foreign department and prevents deleting a referenced department", async () => {
      await client?.begin(async (tx) => {
        await tx.unsafe(fixture).simple();
        await tx.unsafe(migration).simple();
        await tx`UPDATE ssc_responsibility SET department_id='local' WHERE id='legacy'`;
        await expect(
          tx.savepoint(async (nested) => {
            await nested`DELETE FROM department WHERE id='local'`;
          }),
        ).rejects.toMatchObject({ code: "23503" });
        await expect(
          tx.savepoint(async (nested) => {
            await nested`UPDATE ssc_responsibility SET department_id='foreign' WHERE id='legacy'`;
          }),
        ).rejects.toMatchObject({ code: "23503" });
      });
    });
  },
);
