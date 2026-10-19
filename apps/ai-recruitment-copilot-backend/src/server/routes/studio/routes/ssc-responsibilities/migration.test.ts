import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;
const migrationFile = new URL(
  "../../../../../../../ai-recruitment-copilot/drizzle/20261017190000_ssc_responsibilities_optional_identity/migration.sql",
  import.meta.url,
);
// A no-op gives behavioral RED failures before the migration is implemented.
const migration = existsSync(migrationFile) ? readFileSync(migrationFile, "utf-8") : "SELECT 1";
const client = databaseUrl
  ? postgres(databaseUrl, { connect_timeout: 5, max: 1, onnotice: () => {} })
  : null;

const fixtureSql = `
  CREATE TEMP TABLE ssc_responsibility (
    id text PRIMARY KEY, organization_id text NOT NULL,
    demand_owner text NOT NULL DEFAULT '', center_name text NOT NULL,
    ssc_name text NOT NULL, telegram text NOT NULL DEFAULT '', email text NOT NULL,
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT '2026-10-01T00:00:00Z',
    updated_at timestamptz NOT NULL DEFAULT '2026-10-01T00:00:00Z',
    CONSTRAINT ssc_responsibility_center_check CHECK (length(btrim(center_name)) > 0),
    CONSTRAINT ssc_responsibility_name_check CHECK (length(btrim(ssc_name)) > 0),
    CONSTRAINT ssc_responsibility_email_check CHECK (length(btrim(email)) > 0)
  ) ON COMMIT DROP;
  CREATE UNIQUE INDEX ssc_responsibility_workspace_center_email_uq
    ON ssc_responsibility (organization_id, lower(btrim(center_name)), lower(btrim(email)));
`;

afterAll(async () => {
  await client?.end();
});

describe.skipIf(!client || databaseUrl !== process.env.DATABASE_URL)(
  "optional SSC identity additive migration",
  () => {
    it("preserves every existing field and timestamp", async () => {
      await client?.begin(async (tx) => {
        await tx.unsafe(fixtureSql).simple();
        await tx`
          INSERT INTO ssc_responsibility
            (id, organization_id, demand_owner, center_name, ssc_name, telegram, email, notes)
          VALUES ('legacy', 'workspace', 'Owner', 'Existing Center', 'SSC', '@existing', 'existing@example.com', 'Keep this')
        `;
        const before = await tx`SELECT * FROM ssc_responsibility ORDER BY id`;
        await tx.unsafe(migration).simple();
        const after = await tx`SELECT * FROM ssc_responsibility ORDER BY id`;
        expect([...after]).toEqual([...before]);
      });
    });

    it("allows separate blank-email identities and a completely unassigned SSC", async () => {
      await client?.begin(async (tx) => {
        await tx.unsafe(fixtureSql).simple();
        await tx.unsafe(migration).simple();
        await tx`
          INSERT INTO ssc_responsibility (id, organization_id, center_name, ssc_name, email)
          VALUES ('alice', 'workspace', 'Center', 'Alice', ''),
                 ('bob', 'workspace', 'Center', 'Bob', ''),
                 ('unassigned', 'workspace', 'Center', '', '')
        `;
        const rows = await tx`SELECT id FROM ssc_responsibility ORDER BY id`;
        expect(rows.map((row) => row.id)).toEqual(["alice", "bob", "unassigned"]);
      });
    });
  },
);
