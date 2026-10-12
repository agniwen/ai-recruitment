import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Service from "./service";
import type * as Policy from "./policy";
import type * as Admin from "../../../platform/routes/interview-logs/routes/entry-credentials/dao";
import type { CandidateEntryScope } from "./policy";
import { testAuthenticator } from "./test-authenticator";
import { factory } from "../../../../factory";
import type { candidateEntryCredentialRouter } from "../../../studio/routes/resumes/routes/entry-credentials/route";

const access = vi.hoisted(() => ({ authorize: vi.fn(), visibility: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer: () => access.authorize,
}));
vi.mock("../../../../access/resume-visibility", async () => {
  const { sql: fragment } = await import("drizzle-orm");
  return {
    buildResumeVisibilityCondition: () => fragment`studio_interview.id <> 'hidden'`,
    resolveResumeVisibilityScope: access.visibility,
  };
});

vi.mock("../interview-telemetry/dao", () => ({ recordServerTelemetrySafely: vi.fn() }));
const url = process.env.ENTRY_CREDENTIAL_TEST_DATABASE_URL;
const scope = {
  candidateName: "测试候选人",
  interviewRecordId: "candidate",
  liveKitRoomName: "human_test",
  meetingId: "meeting",
  organizationId: "org",
  roundId: "round",
} as CandidateEntryScope;
const headers = () =>
  new Headers({
    "user-agent": "Test Browser",
    "x-interview-browser-id": "00000000-0000-4000-8000-000000000003",
    "x-interview-fingerprint-id": "a".repeat(32),
    "x-interview-tab-id": "00000000-0000-4000-8000-000000000002",
    "x-interview-visit-id": "00000000-0000-4000-8000-000000000001",
    "x-real-ip": "203.0.113.1",
  });

const patch = (json: unknown) => ({
  body: JSON.stringify(json),
  headers: { "Content-Type": "application/json" },
  method: "PATCH",
});

describe.skipIf(!url)("entry credentials with PostgreSQL and real signature verification", () => {
  let sql: ReturnType<typeof postgres>;
  let service: typeof Service;
  let policy: typeof Policy;
  let admin: typeof Admin;
  let exemptions: typeof candidateEntryCredentialRouter;
  beforeAll(async () => {
    if (
      !url ||
      !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
      !new URL(url).pathname.startsWith("/entry_credentials_test_")
    ) {
      throw new Error("Use an isolated local entry_credentials_test_ database");
    }
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("INTERVIEW_ENTRY_CREDENTIAL_ORIGIN", "https://interview.example.test");
    vi.stubEnv("INTERVIEW_TELEMETRY_IP_HEADER", "x-real-ip");
    sql = postgres(url, { max: 1 });
    await sql`create table global_config (organization_id text primary key, updated_at timestamptz, updated_by text)`;
    await sql`create table studio_interview (id text primary key, organization_id text not null, updated_at timestamptz)`;
    await sql`create table "user" (id text primary key, name text)`;
    await sql`insert into "user" values ('hr','招聘负责人')`;
    await sql`create table interview_audit_log (id text primary key, action text, created_at timestamptz, detail jsonb, interview_record_id text, operator_id text, operator_role text, organization_id text, schedule_entry_id text, source text,
      check (detail->>'reason' <> 'fail audit'))`;
    await sql.unsafe(
      await readFile(
        new URL(
          "../../../../../../../ai-recruitment-copilot/drizzle/20261010120000_candidate_entry_credentials/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    // Upgrade an existing enabled workspace and verify the new policy starts closed.
    await sql`insert into global_config (organization_id, candidate_entry_credential_enabled) values ('legacy-org', true)`;
    await sql`insert into studio_interview (id, organization_id) values ('legacy-candidate', 'legacy-org')`;
    await sql.unsafe(
      await readFile(
        new URL(
          "../../../../../../../ai-recruitment-copilot/drizzle/20261012120000_candidate_entry_opt_in/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    expect(
      await sql`select entry_credential_enabled from studio_interview where id='legacy-candidate'`,
    ).toEqual([{ entry_credential_enabled: false }]);
    service = await import("./service");
    policy = await import("./policy");
    admin = await import("../../../platform/routes/interview-logs/routes/entry-credentials/dao");
    const exemptionModule =
      await import("../../../studio/routes/resumes/routes/entry-credentials/route");
    exemptions = exemptionModule.candidateEntryCredentialRouter;
  });
  beforeEach(async () => {
    access.authorize.mockReset().mockResolvedValue(true);
    access.visibility.mockReset().mockResolvedValue({});
    await sql`truncate interview_audit_log`;
    await sql`truncate candidate_entry_credential_use, candidate_entry_challenge, candidate_entry_credential, studio_interview, global_config`;
    await sql`insert into global_config (organization_id) values ('org'), ('other-org')`;
    await sql`insert into studio_interview (id, organization_id) values ('candidate','org'), ('candidate2','org'), ('other-candidate','other-org')`;
  });
  afterAll(async () => {
    if (sql) {
      await sql`drop table candidate_entry_credential_use, candidate_entry_challenge, candidate_entry_credential, studio_interview, global_config, "user", interview_audit_log`;
      await sql.end();
      const { closeDatabase } = await import("@arc/ai-recruitment-copilot-backend/lib/server/db");
      await closeDatabase();
    }
    vi.unstubAllEnvs();
  });

  async function register(authenticator = testAuthenticator()) {
    const options = await service.createEntryOptions(scope, "invite", headers(), "register");
    if (options.kind !== "register") {
      throw new Error("Expected registration");
    }
    const result = await service.verifyEntryCredential(scope, "invite", headers(), {
      challengeId: options.challengeId,
      kind: "register",
      response: authenticator.register(options.options.challenge),
    });
    return { authenticator, handle: options.options.user.id, ...result };
  }

  function managementApp(
    organizationId = "org",
    authenticated = true,
    role = "admin",
    memberRole = "member",
  ) {
    return factory
      .createApp()
      .use(async (c, next) => {
        if (authenticated) {
          c.set("user", { id: "hr", name: "招聘负责人", role } as NonNullable<typeof c.var.user>);
          c.set("member", { role: memberRole } as NonNullable<typeof c.var.member>);
          c.set("activeOrg", { id: organizationId } as NonNullable<typeof c.var.activeOrg>);
        }
        await next();
      })
      .route("/resumes/:id/entry-credentials", exemptions);
  }

  it("authorizes platform admin changes, scopes visible records and atomically records the setting", async () => {
    const app = managementApp();
    const endpoint = "/resumes/candidate/entry-credentials";
    const changed = await app.request(
      endpoint,
      patch({ enabled: true, reason: "浏览器不兼容，已人工确认" }),
    );
    expect(changed.status).toBe(200);
    expect(access.authorize).toHaveBeenCalledWith({ action: "update", resource: "resumeLibrary" });
    expect(access.visibility).toHaveBeenCalledWith({
      currentRole: "member",
      organizationId: "org",
      userId: "hr",
    });
    const state = await app.request(endpoint);
    expect(state.headers.get("Cache-Control")).toBe("no-store");
    expect(await state.json()).toMatchObject({
      enabled: true,
      reason: "浏览器不兼容，已人工确认",
      updatedByName: "招聘负责人",
    });
    const [audit] = await sql`select * from interview_audit_log`;
    expect(audit).toMatchObject({
      detail: { fromEnabled: false, reason: "浏览器不兼容，已人工确认", toEnabled: true },
      interview_record_id: "candidate",
      operator_id: "hr",
      organization_id: "org",
    });
    const blank = await app.request(endpoint, patch({ enabled: false, reason: "  " }));
    expect(blank.status).toBe(400);
    const crossOrg = await managementApp("other-org").request(
      endpoint,
      patch({ enabled: false, reason: "尝试越权" }),
    );
    expect(crossOrg.status).toBe(404);
    await sql`insert into studio_interview (id, organization_id) values ('hidden','org')`;
    const hidden = await app.request(
      "/resumes/hidden/entry-credentials",
      patch({ enabled: true, reason: "不可见" }),
    );
    expect(hidden.status).toBe(404);
    access.authorize.mockResolvedValue(false);
    const denied = await app.request(endpoint, patch({ enabled: false, reason: "未授权" }));
    expect(denied.status).toBe(403);
    const anonymous = await managementApp("org", false).request(
      endpoint,
      patch({ enabled: false, reason: "未登录" }),
    );
    expect(anonymous.status).toBe(401);
    expect(await sql`select count(*)::int as n from interview_audit_log`).toEqual([{ n: 1 }]);
  });

  it("rolls back administrator setting changes when writing its audit fails", async () => {
    const response = await managementApp().request(
      "/resumes/candidate/entry-credentials",
      patch({ enabled: true, reason: "fail audit" }),
    );
    expect(response.status).toBe(500);
    expect(
      await sql`select entry_credential_enabled from studio_interview where id='candidate'`,
    ).toEqual([{ entry_credential_enabled: false }]);
  });

  it("hides and rejects settings for ordinary users, even workspace owners or admins with edit permission", async () => {
    for (const memberRole of ["member", "hr", "admin", "owner"]) {
      const app = managementApp("org", true, "user", memberRole);
      const endpoint = "/resumes/candidate/entry-credentials";
      await expect(app.request(endpoint)).resolves.toMatchObject({ status: 403 });
      await expect(
        app.request(endpoint, patch({ enabled: true, reason: "尝试开启" })),
      ).resolves.toMatchObject({ status: 403 });
    }
    expect(access.authorize).not.toHaveBeenCalled();
    expect(await sql`select count(*)::int as n from interview_audit_log`).toEqual([{ n: 0 }]);
    expect(await policy.getCandidateEntryPolicy(scope)).toEqual({ required: false });
  });

  it("enables only the chosen candidate and allows an administrator to disable it again", async () => {
    const app = managementApp();
    const endpoint = "/resumes/candidate/entry-credentials";
    const initial = await app.request(endpoint);
    expect(await initial.json()).toMatchObject({ enabled: false });
    await expect(
      app.request(endpoint, patch({ enabled: true, reason: "测试开启" })),
    ).resolves.toMatchObject({ status: 200 });
    expect(await policy.getCandidateEntryPolicy(scope)).toEqual({ required: true });
    expect(
      await policy.getCandidateEntryPolicy({ ...scope, interviewRecordId: "candidate2" }),
    ).toEqual({ required: false });
    await expect(
      app.request(endpoint, patch({ enabled: false, reason: "兼容性问题，关闭" })),
    ).resolves.toMatchObject({ status: 200 });
    expect(await policy.getCandidateEntryPolicy(scope)).toEqual({ required: false });
    expect(await sql`select count(*)::int as n from interview_audit_log`).toEqual([{ n: 2 }]);
  });
  async function assertion(
    registered: Awaited<ReturnType<typeof register>>,
    candidateScope = scope,
    counter = 0,
  ) {
    const options = await service.createEntryOptions(
      candidateScope,
      "invite",
      headers(),
      "authenticate",
    );
    return {
      challengeId: options.challengeId,
      kind: "authenticate" as const,
      response: registered.authenticator.authenticate(
        options.options.challenge,
        registered.handle,
        counter,
      ),
    };
  }

  it("defaults off; candidate opt-in enforces proof; disabling immediately permits entry", async () => {
    expect(await policy.getCandidateEntryPolicy(scope)).toEqual({ required: false });
    await expect(
      policy.checkCandidateEntryProof(scope, "invite", headers()),
    ).resolves.toMatchObject({ allowed: true });
    await sql`update studio_interview set entry_credential_enabled=true where id='candidate'`;
    await expect(
      policy.checkCandidateEntryProof(scope, "invite", headers()),
    ).resolves.toMatchObject({ allowed: false });
    await sql`update studio_interview set entry_credential_enabled=false where id='candidate'`;
    await expect(
      policy.checkCandidateEntryProof(scope, "invite", headers()),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      policy.getCandidateEntryPolicy({ ...scope, organizationId: "other-org" }),
    ).rejects.toThrow();
  });

  it("binds a verified session to invite, candidate, organization, meeting, round and visit; hashes secrets", async () => {
    await sql`update studio_interview set entry_credential_enabled=true`;
    const result = await register();
    const h = headers();
    h.set("x-interview-entry-proof", result.proof);
    expect(await policy.checkCandidateEntryProof(scope, "invite", h)).toMatchObject({
      allowed: true,
      credentialRef: result.credentialRef,
    });
    for (const altered of [
      { ...scope, meetingId: "other-meeting" },
      { ...scope, roundId: "other-round" },
      { ...scope, interviewRecordId: "candidate2" },
      { ...scope, interviewRecordId: "other-candidate", organizationId: "other-org" },
    ]) {
      await expect(policy.checkCandidateEntryProof(altered, "invite", h)).resolves.toMatchObject({
        allowed: false,
      });
    }
    await expect(policy.checkCandidateEntryProof(scope, "other-invite", h)).resolves.toMatchObject({
      allowed: false,
    });
    h.set("x-interview-visit-id", randomUUID());
    await expect(policy.checkCandidateEntryProof(scope, "invite", h)).resolves.toMatchObject({
      allowed: false,
    });
    const [stored] = await sql`select * from candidate_entry_credential_use`;
    expect(stored).toMatchObject({
      fingerprint_id: "a".repeat(32),
      invite_hash: policy.hashEntrySecret("invite"),
      ip: "203.0.113.1",
      proof_hash: policy.hashEntrySecret(result.proof),
    });
    await sql`update candidate_entry_credential_use set expires_at = now() - interval '1 second'`;
    h.set("x-interview-visit-id", headers().get("x-interview-visit-id") ?? "");
    await expect(policy.checkCandidateEntryProof(scope, "invite", h)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("authenticates the same synced credential across candidate records while zero counters remain valid", async () => {
    const registered = await register();
    const candidate2 = {
      ...scope,
      candidateName: "第二位",
      interviewRecordId: "candidate2",
      meetingId: "meeting2",
      roundId: "round2",
    };
    const verified = await service.verifyEntryCredential(
      candidate2,
      "invite",
      headers(),
      await assertion(registered, candidate2),
    );
    expect(verified.credentialRef).toBe(registered.credentialRef);
    expect(await sql`select count(*)::int as n from candidate_entry_credential`).toEqual([
      { n: 1 },
    ]);
    const otherOrg = {
      ...candidate2,
      interviewRecordId: "other-candidate",
      meetingId: "meeting3",
      organizationId: "other-org",
    };
    await service.verifyEntryCredential(
      otherOrg,
      "invite",
      headers(),
      await assertion(registered, otherOrg),
    );
    const logs = await admin.loadMeetingEntryCredentials(scope.meetingId);
    expect(logs.records[0].summary).toEqual({
      browsers: 1,
      candidates: 2,
      fingerprints: 1,
      meetings: 2,
      uses: 2,
    });
    expect(logs.records[0].associations.every((row) => row.candidateId !== "other-candidate")).toBe(
      true,
    );
    const serialized = JSON.stringify(logs);
    for (const secret of [
      "publicKey",
      "credentialId",
      "userHandle",
      "proofHash",
      "inviteHash",
      registered.proof,
      registered.handle,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("atomically consumes challenges once, including failures, and serializes signature counters", async () => {
    const registered = await register(testAuthenticator(false));
    const input = await assertion(registered, scope, 1);
    const attempts = await Promise.allSettled([
      service.verifyEntryCredential(scope, "invite", headers(), input),
      service.verifyEntryCredential(scope, "invite", headers(), input),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const repeatedCounter = await assertion(registered, scope, 1);
    await expect(
      service.verifyEntryCredential(scope, "invite", headers(), repeatedCounter),
    ).rejects.toThrow();
    expect(await sql`select count(*)::int as n from candidate_entry_challenge`).toEqual([{ n: 0 }]);
    await expect(
      service.verifyEntryCredential(scope, "invite", headers(), repeatedCounter),
    ).rejects.toThrow("Challenge expired or used");
  });

  it.each(["origin", "rpId", "challenge", "signature", "userHandle"])(
    "rejects a tampered %s with the real verifier",
    async (field) => {
      const registered = await register();
      const options = await service.createEntryOptions(scope, "invite", headers(), "authenticate");
      const response = registered.authenticator.authenticate(
        field === "challenge" ? "wrong-challenge" : options.options.challenge,
        field === "userHandle" ? "wrong-user" : registered.handle,
        0,
        field === "origin" ? "https://attacker.example.test" : undefined,
        field === "rpId" ? "attacker.example.test" : undefined,
      );
      if (field === "signature") {
        response.response.signature = Buffer.alloc(64, 42).toString("base64url");
      }
      await expect(
        service.verifyEntryCredential(scope, "invite", headers(), {
          challengeId: options.challengeId,
          kind: "authenticate",
          response,
        }),
      ).rejects.toThrow();
      expect(await sql`select count(*)::int as n from candidate_entry_credential_use`).toEqual([
        { n: 1 },
      ]);
      expect(await sql`select count(*)::int as n from candidate_entry_challenge`).toEqual([
        { n: 0 },
      ]);
    },
  );

  it("rejects expired/cross-scope challenges and never replaces an existing registered key", async () => {
    const registered = await register();
    const input = await assertion(registered);
    await expect(
      service.verifyEntryCredential({ ...scope, meetingId: "wrong" }, "invite", headers(), input),
    ).rejects.toThrow();
    await sql`update candidate_entry_challenge set expires_at=now()-interval '1 second'`;
    await expect(
      service.verifyEntryCredential(scope, "invite", headers(), input),
    ).rejects.toThrow();
    await expect(register(registered.authenticator)).rejects.toThrow();
    expect(await sql`select count(*)::int as n from candidate_entry_credential`).toEqual([
      { n: 1 },
    ]);
    const [credential] = await sql`select user_handle from candidate_entry_credential`;
    expect(credential.user_handle).toBe(registered.handle);
  });

  it("has Chinese descriptions on all new tables and columns", async () => {
    const columns =
      await sql`select col_description(c.oid,a.attnum) as description from pg_class c join pg_attribute a on a.attrelid=c.oid
      where c.relname in ('candidate_entry_credential','candidate_entry_challenge','candidate_entry_credential_use') and a.attnum>0 and not a.attisdropped`;
    expect(columns.length).toBeGreaterThan(30);
    expect(columns.every((row) => /[\u4E00-\u9FFF]/.test(row.description ?? ""))).toBe(true);
  });
});
