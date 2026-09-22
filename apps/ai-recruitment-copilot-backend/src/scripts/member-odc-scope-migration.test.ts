import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../ai-recruitment-copilot/drizzle/20260921170000_member_odc_scope/migration.sql",
    import.meta.url,
  ),
  "utf-8",
);
const databaseUrl = process.env.ODC_MIGRATION_TEST_DATABASE_URL;

// Explicit opt-in and session-local tables: never use the application's DATABASE_URL.
describe.skipIf(!databaseUrl)("member ODC scope migration", () => {
  const client = postgres(databaseUrl ?? "", {
    connect_timeout: 5,
    max: 1,
    onnotice: () => {},
  });
  beforeAll(async () => {
    await client`CREATE TEMP TABLE member (id text PRIMARY KEY)`;
    await client`CREATE TEMP TABLE platform_pre_registration (id text PRIMARY KEY)`;
  });
  beforeEach(async () => {
    await client`ALTER TABLE pg_temp.member DROP COLUMN IF EXISTS odc_scope_mode CASCADE`;
    await client`ALTER TABLE pg_temp.platform_pre_registration DROP COLUMN IF EXISTS odc_scope_mode CASCADE`;
    await client`TRUNCATE pg_temp.member, pg_temp.platform_pre_registration`;
  });
  afterAll(async () => {
    await client.end();
  });

  it("creates missing columns, defaults and checks, and can run twice", async () => {
    await client`INSERT INTO member VALUES ('existing')`;
    await client.unsafe(migration);
    await client.unsafe(migration);
    expect(await client`SELECT odc_scope_mode FROM member`).toEqual([
      { odc_scope_mode: "selected" },
    ]);
    await client`INSERT INTO platform_pre_registration (id) VALUES ('new')`;
    expect(await client`SELECT odc_scope_mode FROM platform_pre_registration`).toEqual([
      { odc_scope_mode: "selected" },
    ]);
    await expect(client`UPDATE member SET odc_scope_mode = 'invalid'`).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      client`UPDATE platform_pre_registration SET odc_scope_mode = NULL`,
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("preserves db-push columns, constraints and all-mode data", async () => {
    await client`ALTER TABLE member ADD COLUMN odc_scope_mode text DEFAULT 'selected' NOT NULL,
      ADD CONSTRAINT member_odc_scope_mode_check CHECK (odc_scope_mode IN ('all', 'selected'))`;
    await client`ALTER TABLE platform_pre_registration ADD COLUMN odc_scope_mode text DEFAULT 'selected' NOT NULL,
      ADD CONSTRAINT pre_registration_odc_scope_mode_check CHECK (odc_scope_mode IN ('all', 'selected'))`;
    await client`INSERT INTO member VALUES ('m', 'all')`;
    await client`INSERT INTO platform_pre_registration VALUES ('p', 'all')`;
    await client.unsafe(migration);
    expect(await client`SELECT odc_scope_mode FROM member`).toEqual([{ odc_scope_mode: "all" }]);
    expect(await client`SELECT odc_scope_mode FROM platform_pre_registration`).toEqual([
      { odc_scope_mode: "all" },
    ]);
  });

  it("completes partially pushed columns without constraints", async () => {
    await client`ALTER TABLE member ADD COLUMN odc_scope_mode text DEFAULT 'selected' NOT NULL`;
    await client.unsafe(migration);
    await expect(client`INSERT INTO member VALUES ('m', 'invalid')`).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      client`INSERT INTO platform_pre_registration VALUES ('p', 'invalid')`,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    "integer DEFAULT 0 NOT NULL",
    "text DEFAULT 'all' NOT NULL",
    "text DEFAULT 'selected'",
    "text NOT NULL",
  ])("rejects mismatched column definition: %s", async (definition) => {
    await client.unsafe(`ALTER TABLE member ADD COLUMN odc_scope_mode ${definition}`);
    await expect(client.unsafe(migration)).rejects.toThrow(
      "Unexpected definition for member.odc_scope_mode",
    );
  });

  it("rolls back additions when the second table has an incompatible definition", async () => {
    await client`ALTER TABLE platform_pre_registration ADD COLUMN odc_scope_mode text DEFAULT 'all' NOT NULL`;
    await expect(client.unsafe(migration)).rejects.toThrow(
      "Unexpected definition for platform_pre_registration.odc_scope_mode",
    );
    const columns = await client`SELECT attname FROM pg_attribute
      WHERE attrelid = 'pg_temp.member'::regclass AND attname = 'odc_scope_mode' AND NOT attisdropped`;
    expect(columns).toHaveLength(0);
  });

  it("rejects a same-name check with the wrong definition", async () => {
    await client`ALTER TABLE member ADD COLUMN odc_scope_mode text DEFAULT 'selected' NOT NULL,
      ADD CONSTRAINT member_odc_scope_mode_check CHECK (odc_scope_mode IN ('all', 'selected', 'invalid'))`;
    await expect(client.unsafe(migration)).rejects.toThrow(
      "Unexpected definition for member_odc_scope_mode_check",
    );
  });
});
