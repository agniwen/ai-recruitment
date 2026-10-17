import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../../ai-recruitment-copilot/drizzle/20261017143000_enroll_open_offer_drafts_ssc/migration.sql",
  import.meta.url,
);
// An absent data migration is the no-op baseline: eligible rows must fail the
// behavioral assertion, instead of failing test collection with ENOENT.
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf-8") : "SELECT 1";
const databaseUrl = process.env.SSC_MIGRATION_TEST_DATABASE_URL;

// Explicit opt-in, a single connection and session-local tables keep the entire
// migration test away from application tables, even in a populated database.
describe.skipIf(!databaseUrl)("enroll open legacy Offer drafts into SSC", () => {
  const client = postgres(databaseUrl ?? "", {
    connect_timeout: 5,
    max: 1,
    onnotice: () => {},
  });

  beforeAll(async () => {
    await client`CREATE TEMP TABLE studio_interview (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      pipeline_stage text NOT NULL,
      outcome text NOT NULL
    )`;
    await client`CREATE TEMP TABLE studio_offer_draft (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      interview_record_id text NOT NULL,
      version integer NOT NULL,
      status text NOT NULL,
      sent_at timestamptz,
      response_at timestamptz,
      ssc_confirmation_status text,
      ssc_revision integer NOT NULL DEFAULT 1,
      ssc_received_by text,
      ssc_received_at timestamptz,
      ssc_completed_by text,
      ssc_completed_at timestamptz,
      base_salary integer NOT NULL DEFAULT 30000,
      notes text DEFAULT 'keep original terms',
      created_at timestamptz NOT NULL DEFAULT '2026-09-23T00:00:00Z',
      updated_at timestamptz NOT NULL DEFAULT '2026-09-23T00:00:00Z',
      UNIQUE (interview_record_id, version)
    )`;
  });
  beforeEach(async () => {
    await client`TRUNCATE pg_temp.studio_offer_draft, pg_temp.studio_interview`;
  });
  afterAll(async () => {
    await client.end();
  });

  async function seedCandidate(stage = "offer", outcome = "in_pipeline") {
    await client`INSERT INTO studio_interview (id, organization_id, pipeline_stage, outcome)
      VALUES ('candidate', 'workspace', ${stage}, ${outcome})`;
  }

  async function seedOffer(
    input: {
      version?: number;
      status?: string;
      sentAt?: string | null;
      responseAt?: string | null;
      sscStatus?: string | null;
    } = {},
  ) {
    const version = input.version ?? 1;
    await client`INSERT INTO studio_offer_draft
      (id, organization_id, interview_record_id, version, status, sent_at, response_at, ssc_confirmation_status)
      VALUES (${`offer-${version}`}, 'workspace', 'candidate', ${version}, ${input.status ?? "draft"},
        ${input.sentAt ?? null}, ${input.responseAt ?? null}, ${input.sscStatus ?? null})`;
  }

  it("enrolls only the current unsent legacy draft, preserving revision and Offer terms", async () => {
    await seedCandidate();
    await seedOffer({ status: "superseded", version: 1 });
    await seedOffer({ status: "superseded", version: 2 });
    await seedOffer({ version: 3 });
    await client.unsafe(migration);
    const rows = await client`SELECT * FROM studio_offer_draft ORDER BY version`;
    expect(rows.map((row) => row.ssc_confirmation_status)).toEqual([null, null, "pending"]);
    expect(rows[2]).toMatchObject({
      base_salary: 30_000,
      created_at: new Date("2026-09-23T00:00:00Z"),
      notes: "keep original terms",
      response_at: null,
      sent_at: null,
      ssc_completed_at: null,
      ssc_completed_by: null,
      ssc_received_at: null,
      ssc_received_by: null,
      ssc_revision: 1,
      status: "draft",
      version: 3,
    });
  });

  it.each([
    ["closed", "hired"],
    ["closed", "withdrawn"],
    ["screening", "in_pipeline"],
    ["written_test", "in_pipeline"],
    ["ai_review", "in_pipeline"],
    ["ai_interview", "in_pipeline"],
    ["human_interview", "in_pipeline"],
  ])("leaves candidate stage %s / outcome %s unchanged", async (stage, outcome) => {
    await seedCandidate(stage, outcome);
    await seedOffer();
    const before = await client`SELECT * FROM studio_offer_draft`;
    await client.unsafe(migration);
    expect(await client`SELECT * FROM studio_offer_draft`).toEqual(before);
  });

  it.each(["sent", "accepted", "declined", "expired", "deleted", "superseded"])(
    "does not enroll historical Offer status %s",
    async (status) => {
      await seedCandidate();
      await seedOffer({ status });
      const before = await client`SELECT * FROM studio_offer_draft`;
      await client.unsafe(migration);
      expect(await client`SELECT * FROM studio_offer_draft`).toEqual(before);
    },
  );

  it.each(["deleted", "superseded"])(
    "does not revive an older draft when the true newest version is %s",
    async (status) => {
      await seedCandidate();
      await seedOffer({ version: 1 });
      await seedOffer({ status, version: 2 });
      const before = await client`SELECT * FROM studio_offer_draft ORDER BY version`;
      await client.unsafe(migration);
      expect(await client`SELECT * FROM studio_offer_draft ORDER BY version`).toEqual(before);
    },
  );

  it.each([{ sentAt: "2026-09-24T00:00:00Z" }, { responseAt: "2026-09-24T00:00:00Z" }])(
    "does not enroll a draft with an existing send or response fact: %j",
    async (facts) => {
      await seedCandidate();
      await seedOffer(facts);
      const before = await client`SELECT * FROM studio_offer_draft`;
      await client.unsafe(migration);
      expect(await client`SELECT * FROM studio_offer_draft`).toEqual(before);
    },
  );

  it.each(["pending", "confirming", "completed"])(
    "preserves existing SSC state %s",
    async (sscStatus) => {
      await seedCandidate();
      await seedOffer({ sscStatus });
      await client`UPDATE studio_offer_draft SET ssc_revision = 4,
      ssc_received_by = 'receiver', ssc_received_at = '2026-10-17T01:00:00Z',
      ssc_completed_by = 'finisher', ssc_completed_at = '2026-10-17T02:00:00Z'`;
      const before = await client`SELECT * FROM studio_offer_draft`;
      await client.unsafe(migration);
      expect(await client`SELECT * FROM studio_offer_draft`).toEqual(before);
    },
  );

  it("does not enroll an Offer attached to a different candidate organization", async () => {
    await seedCandidate();
    await seedOffer();
    await client`UPDATE studio_offer_draft SET organization_id = 'other-workspace'`;
    const before = await client`SELECT * FROM studio_offer_draft`;
    await client.unsafe(migration);
    expect(await client`SELECT * FROM studio_offer_draft`).toEqual(before);
  });

  it("is idempotent after enrollment", async () => {
    await seedCandidate();
    await seedOffer();
    await client.unsafe(migration);
    const firstRun = await client`SELECT * FROM studio_offer_draft`;
    expect(firstRun[0].ssc_confirmation_status).toBe("pending");
    await client.unsafe(migration);
    expect(await client`SELECT * FROM studio_offer_draft`).toEqual(firstRun);
  });
});
