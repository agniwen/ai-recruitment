import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

export async function createSecurityTestDatabase() {
  // No connection string: the database lives entirely in this test process.
  const client = new PGlite();
  await client.exec(`
    create table "user" (
      id text primary key, email text not null unique, name text not null, email_verified boolean not null default false,
      image text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      role text not null default 'user', banned boolean not null default false, ban_reason text, ban_expires timestamptz,
      last_active_at timestamptz, last_active_organization_id text, remark text, telegram text, telegram_chat_id text,
      telegram_bound_username text, feishu_tenant_key text, feishu_tenant_name text
    );
    create table session (
      id text primary key, user_id text not null references "user"(id) on delete cascade, token text not null unique,
      expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      active_organization_id text, impersonated_by text, ip_address text, user_agent text
    );
    create table account (
      id text primary key, user_id text not null references "user"(id), account_id text not null, provider_id text not null,
      password text, access_token text, refresh_token text, id_token text, scope text,
      access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table global_config (id text primary key);
    create table studio_interview (id text primary key);
    create table studio_human_interview_meeting (id text primary key, organization_id text, title text, livekit_room_name text);
  `);
  for (const migration of [
    "20261008120000_add_interview_telemetry",
    "20261009231000_interview_browser_evidence_columns",
    "20261009200000_interview_media",
    "20261010120000_candidate_entry_credentials",
    "20261013120000_entry_credential_responses",
    "20261016120000_platform_mfa_ip_encryption",
    "20261016170000_platform_mfa_replacement",
  ]) {
    await client.exec(
      await readFile(
        new URL(
          `../../../ai-recruitment-copilot/drizzle/${migration}/migration.sql`,
          import.meta.url,
        ),
        "utf-8",
      ),
    );
  }
  return { client, db: drizzle({ client }) };
}
