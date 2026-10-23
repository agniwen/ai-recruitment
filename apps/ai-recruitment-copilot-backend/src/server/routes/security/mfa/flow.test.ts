import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generate } from "otplib";
import { eq } from "drizzle-orm";
import { installSecurityTestKeys } from "../../../../test-utils/security-keys";
import { runWithRequestPeerIp } from "../../../../lib/server/request-ip-context";
import { createSecurityTestDatabase } from "../../../../test-utils/security-database";
import {
  interviewTelemetryEvent as events,
  platformMfaFactor as factor,
  platformMfaGrant as grant,
  platformSecurityAudit as audit,
  session,
  user,
} from "@arc/db-schema/schema";
import {
  beginMfaEnrollment,
  getMfaStatus,
  requireRecentMfa,
  renewMfaActivity,
  verifyMfa,
} from "./service";
import { beginMfaReplacement, confirmMfaReplacement } from "./replacement";
import { describeFactor } from "./crypto";
import { MFA_COOKIE } from "./policy";
import {
  decryptIp,
  encryptIp,
  ipContext,
  ipLookupHash,
} from "../../../../lib/server/ip-encryption";
import {
  saveClientEvents,
  recordServerTelemetry,
} from "../../../routes/public/routes/interview-telemetry/dao";
import { revealStoredIp } from "../../platform/routes/interview-logs/routes/ip/dao";
import { createIpRouter } from "../../platform/routes/interview-logs/routes/ip/route";
import { factory } from "../../../factory";
import { securityRouter } from "../route";
import { backfillEncryptedIps } from "../../../../scripts/backfill-encrypted-ips";
import type { Database } from "../../../../lib/server/db";
import { loadMeetingLog } from "../../platform/routes/interview-logs/dao";
import { loadMeetingEntryCredentials } from "../../platform/routes/interview-logs/routes/entry-credentials/dao";
import { loadMeetingMedia } from "../../platform/routes/interview-logs/routes/media/dao";
import { logQuerySchema } from "../../platform/routes/interview-logs/schema";

const state = vi.hoisted(() => ({
  database: null as Awaited<ReturnType<typeof createSecurityTestDatabase>> | null,
}));
function getDatabase() {
  if (!state.database) {
    throw new Error("Test database not initialized");
  }
  return state.database;
}
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  get db() {
    return getDatabase().db;
  },
}));
beforeAll(async () => {
  installSecurityTestKeys();
  vi.stubEnv("BETTER_AUTH_URL", "https://arc.example.invalid");
  state.database = await createSecurityTestDatabase();
});
afterAll(async () => {
  await state.database?.client.close();
  vi.unstubAllEnvs();
});

async function newAdmin() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await getDatabase()
    .db.insert(user)
    .values({ email: `${userId}@example.invalid`, id: userId, name: "Test admin", role: "admin" });
  await getDatabase()
    .db.insert(session)
    .values({
      expiresAt: new Date(Date.now() + 86_400_000),
      id: sessionId,
      token: randomUUID(),
      updatedAt: new Date(),
      userId,
    });
  return { sessionId, userId };
}
async function enrolledAdmin() {
  const principal = await newAdmin();
  const setup = await beginMfaEnrollment(principal);
  const code = await generate({ secret: setup.secret });
  const result = await verifyMfa(principal, { code, method: "totp" });
  const headers = new Headers({ cookie: `${MFA_COOKIE}=${result.token}` });
  return { code, headers, principal, result, setup };
}

describe("platform MFA and explicit IP reveal in isolated PostgreSQL", () => {
  it("enrolls, requires both cookies, scopes the grant to one session and does not slide expiry", async () => {
    const { headers, principal, result } = await enrolledAdmin();
    expect(result.recoveryCodes).toHaveLength(10);
    const [stored] = await getDatabase()
      .db.select()
      .from(factor)
      .where(eq(factor.userId, principal.userId));
    expect(JSON.stringify(stored)).not.toContain(result.recoveryCodes[0]);
    await expect(requireRecentMfa(principal, new Headers())).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    expect(await requireRecentMfa(principal, headers)).toBe(result.expiresAt);
    expect(await requireRecentMfa(principal, headers)).toBe(result.expiresAt);
    const otherSession = randomUUID();
    await getDatabase()
      .db.insert(session)
      .values({
        expiresAt: new Date(Date.now() + 60_000),
        id: otherSession,
        token: randomUUID(),
        updatedAt: new Date(),
        userId: principal.userId,
      });
    await expect(
      requireRecentMfa({ ...principal, sessionId: otherSession }, headers),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await getDatabase()
      .db.update(grant)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(grant.sessionId, principal.sessionId));
    const expiredStatus = await getMfaStatus(principal, headers);
    expect(expiredStatus.expiresAt).toBeNull();
  });
  it("slides a valid grant from user activity, never from reads, and cannot revive an expired grant", async () => {
    const { headers, principal, result } = await enrolledAdmin();
    await getDatabase()
      .db.update(grant)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(grant.sessionId, principal.sessionId));
    const activeAt = Date.now() - 2000;
    const renewed = await renewMfaActivity(principal, headers, activeAt);
    expect(renewed.expiresAt).toBe(new Date(activeAt + 900_000).toISOString());
    expect(renewed.token).toBe(result.token);
    expect(await requireRecentMfa(principal, headers)).toBe(renewed.expiresAt);
    const status = await getMfaStatus(principal, headers);
    expect(status.expiresAt).toBe(renewed.expiresAt);
    const delayed = await renewMfaActivity(principal, headers, activeAt - 60_000);
    expect(delayed.expiresAt).toBe(renewed.expiresAt);
    const future = await renewMfaActivity(principal, headers, Date.now() + 86_400_000);
    expect(Date.parse(future.expiresAt)).toBeLessThanOrEqual(Date.now() + 900_000);
    await expect(renewMfaActivity(principal, new Headers(), Date.now())).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await getDatabase()
      .db.update(grant)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(grant.sessionId, principal.sessionId));
    await expect(renewMfaActivity(principal, headers, Date.now())).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
  });
  it("serializes TOTP/recovery-code consumption and persists failures across requests", async () => {
    const { code, principal, result } = await enrolledAdmin();
    await expect(verifyMfa(principal, { code, method: "totp" })).rejects.toMatchObject({
      code: "MFA_INVALID_CODE",
    });
    const attempts = await Promise.allSettled(
      [1, 2].map(() => verifyMfa(principal, { code: result.recoveryCodes[0], method: "recovery" })),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    for (let i = 0; i < 4; i += 1) {
      await expect(
        verifyMfa(principal, { code: "0".repeat(32), method: "recovery" }),
      ).rejects.toThrow();
    }
    await expect(
      verifyMfa(principal, { code: result.recoveryCodes[1], method: "recovery" }),
    ).rejects.toMatchObject({ code: "MFA_LOCKED" });
    const [stored] = await getDatabase()
      .db.select()
      .from(factor)
      .where(eq(factor.userId, principal.userId));
    expect(stored.failedAttempts).toBe(5);
    expect(stored.lockedUntil).toBeInstanceOf(Date);
  });
  it("rejects revoked sessions and roles but allows first binding directly from an older valid login", async () => {
    const { principal, headers } = await enrolledAdmin();
    await getDatabase().db.update(user).set({ role: "user" }).where(eq(user.id, principal.userId));
    await expect(requireRecentMfa(principal, headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(beginMfaEnrollment(principal)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await getDatabase().db.update(user).set({ role: "admin" }).where(eq(user.id, principal.userId));
    await getDatabase()
      .db.update(session)
      .set({ impersonatedBy: "other" })
      .where(eq(session.id, principal.sessionId));
    await expect(requireRecentMfa(principal, headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await getDatabase().db.delete(session).where(eq(session.id, principal.sessionId));
    await expect(requireRecentMfa(principal, headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await getDatabase().db.select().from(grant).where(eq(grant.sessionId, principal.sessionId)),
    ).toHaveLength(0);
    const stale = await newAdmin();
    await getDatabase()
      .db.update(session)
      .set({ createdAt: new Date(Date.now() - 660_000) })
      .where(eq(session.id, stale.sessionId));
    const initial = await beginMfaEnrollment(stale);
    const repeated = await beginMfaEnrollment(stale);
    expect(repeated.secret).toBe(initial.secret);
    const completed = await verifyMfa(stale, {
      code: await generate({ secret: initial.secret }),
      method: "totp",
    });
    expect(completed.recoveryCodes).toHaveLength(10);
  });
  it("decrypts only the selected scoped object and audits without retaining IP values", async () => {
    const { principal, headers, result } = await enrolledAdmin();
    const id = randomUUID();
    const ip = "203.0.113.10";
    await getDatabase()
      .db.insert(events)
      .values({
        eventKey: id,
        id,
        ip: await encryptIp(ip, ipContext("telemetry", "workspace", id)),
        meetingId: "meeting",
        meetingTitle: "Test",
        occurredAt: new Date(),
        organizationId: "workspace",
        source: "server",
        type: "token_issued",
      });
    const reference = { id, kind: "telemetry" as const, meetingId: "meeting" };
    expect(await revealStoredIp(reference, principal, headers)).toEqual({
      expiresAt: result.expiresAt,
      ip,
      region: null,
    });
    expect(
      await revealStoredIp({ ...reference, meetingId: "other" }, principal, headers),
    ).toBeNull();
    await expect(revealStoredIp(reference, principal, new Headers())).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const rows = await getDatabase()
      .db.select()
      .from(audit)
      .where(eq(audit.actorId, principal.userId));
    expect(
      rows.some((row) => row.action === "ip.reveal.telemetry" && row.outcome === "success"),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(ip);
    expect(JSON.stringify(rows)).not.toContain("ip:v1:");
  });
  it("keeps the active factor until replacement succeeds, then revokes old grants and recovery codes", async () => {
    const { principal, headers, result, setup } = await enrolledAdmin();
    const other = { ...principal, sessionId: randomUUID() };
    await getDatabase()
      .db.insert(session)
      .values({
        expiresAt: new Date(Date.now() + 86_400_000),
        id: other.sessionId,
        token: randomUUID(),
        updatedAt: new Date(),
        userId: principal.userId,
      });
    const otherAuthorization = await verifyMfa(other, {
      code: result.recoveryCodes[0],
      method: "recovery",
    });
    const otherHeaders = new Headers({ cookie: `${MFA_COOKIE}=${otherAuthorization.token}` });
    await expect(beginMfaReplacement(principal, new Headers())).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const next = await beginMfaReplacement(principal, headers);
    expect(next.secret).not.toBe(setup.secret);
    const repeated = await beginMfaReplacement(principal, headers);
    expect(repeated.secret).toBe(next.secret);
    const [before] = await getDatabase()
      .db.select()
      .from(factor)
      .where(eq(factor.userId, principal.userId));
    const original = await describeFactor(before.secret, principal.userId, "admin@example.invalid");
    expect(original.secret).toBe(setup.secret);
    const code = await generate({ secret: next.secret });
    await expect(confirmMfaReplacement(other, otherHeaders, code)).rejects.toMatchObject({
      code: "MFA_REPLACEMENT_REQUIRED",
    });
    const updated = await confirmMfaReplacement(principal, headers, code);
    expect(updated.recoveryCodes).toHaveLength(10);
    const updatedHeaders = new Headers({ cookie: `${MFA_COOKIE}=${updated.token}` });
    expect(await requireRecentMfa(principal, updatedHeaders)).toBe(updated.expiresAt);
    await expect(requireRecentMfa(principal, headers)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await expect(requireRecentMfa(other, otherHeaders)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await expect(
      verifyMfa(principal, { code: result.recoveryCodes[1], method: "recovery" }),
    ).rejects.toMatchObject({ code: "MFA_INVALID_CODE" });
    const [after] = await getDatabase()
      .db.select()
      .from(factor)
      .where(eq(factor.userId, principal.userId));
    const updatedFactor = await describeFactor(
      after.secret,
      principal.userId,
      "admin@example.invalid",
    );
    expect(updatedFactor.secret).toBe(next.secret);
    expect(after.pendingSecret).toBeNull();
  });
  it("rejects expired replacement requests and persists failed-code attempts without replacing the active factor", async () => {
    const { principal, headers, setup } = await enrolledAdmin();
    const replacement = await beginMfaReplacement(principal, headers);
    await getDatabase()
      .db.update(factor)
      .set({ pendingExpiresAt: new Date(Date.now() - 1) })
      .where(eq(factor.userId, principal.userId));
    await expect(
      confirmMfaReplacement(principal, headers, await generate({ secret: replacement.secret })),
    ).rejects.toMatchObject({ code: "MFA_REPLACEMENT_REQUIRED" });
    const current = await beginMfaReplacement(principal, headers);
    const now = Math.floor(Date.now() / 1000);
    const accepted = new Set(
      await Promise.all(
        [-30, 0, 30].map((offset) => generate({ epoch: now + offset, secret: current.secret })),
      ),
    );
    const invalidCode = ["000000", "111111", "222222", "333333"].find(
      (code) => !accepted.has(code),
    );
    if (!invalidCode) {
      throw new Error("No invalid test code");
    }
    await expect(confirmMfaReplacement(principal, headers, invalidCode)).rejects.toMatchObject({
      code: "MFA_INVALID_CODE",
    });
    const [stored] = await getDatabase()
      .db.select()
      .from(factor)
      .where(eq(factor.userId, principal.userId));
    expect(stored.failedAttempts).toBe(1);
    const unchanged = await describeFactor(
      stored.secret,
      principal.userId,
      "admin@example.invalid",
    );
    expect(unchanged.secret).toBe(setup.secret);
  });
  it("protects the HTTP boundary, rejects CSRF and never calls decrypt on failed MFA", async () => {
    const { principal, result } = await enrolledAdmin();
    const reveal = vi.fn().mockResolvedValue({ expiresAt: result.expiresAt, ip: "203.0.113.10" });
    const app = factory
      .createApp()
      .use(async (c, next) => {
        c.set("user", { id: principal.userId, role: "admin" } as typeof c.var.user);
        c.set("session", { id: principal.sessionId } as typeof c.var.session);
        await next();
      })
      .route("/ip", createIpRouter(reveal))
      .route("/security", securityRouter);
    const body = JSON.stringify({ id: "id", kind: "telemetry", meetingId: "meeting" });
    const request = {
      body,
      headers: { "content-type": "application/json", origin: "https://arc.example.invalid" },
      method: "POST",
    };
    const denied = await app.request("/ip/reveal", request);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "MFA_REQUIRED" });
    expect(reveal).not.toHaveBeenCalled();
    const accepted = await app.request("/ip/reveal", {
      ...request,
      headers: { ...request.headers, cookie: `${MFA_COOKIE}=${result.token}` },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("Cache-Control")).toBe("no-store");
    const crossOrigin = await app.request("/security/mfa/enroll", {
      ...request,
      headers: { ...request.headers, origin: "https://evil.example.invalid" },
    });
    expect(crossOrigin.status).toBe(403);
  });
  it("renews the HttpOnly cookie only for authenticated same-origin activity and never returns the token", async () => {
    const { headers, principal } = await enrolledAdmin();
    const app = factory
      .createApp()
      .use(async (c, next) => {
        c.set("user", { id: principal.userId, role: "admin" } as typeof c.var.user);
        c.set("session", { id: principal.sessionId } as typeof c.var.session);
        await next();
      })
      .route("/security", securityRouter);
    await getDatabase()
      .db.update(grant)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(grant.sessionId, principal.sessionId));
    const activeAt = Date.now() - 30_000;
    const requestHeaders = {
      "content-type": "application/json",
      cookie: headers.get("cookie") ?? "",
      origin: "https://arc.example.invalid",
    };
    const request = { body: JSON.stringify({ activeAt }), headers: requestHeaders, method: "POST" };
    const response = await app.request("/security/mfa/activity", request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expiresAt: new Date(activeAt + 900_000).toISOString(),
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=870");
    const denied = await app.request("/security/mfa/activity", {
      ...request,
      headers: { ...requestHeaders, origin: "https://evil.example.invalid" },
    });
    expect(denied.status).toBe(403);
    const missing = await app.request("/security/mfa/activity", {
      ...request,
      headers: { ...requestHeaders, cookie: "" },
    });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ code: "MFA_REQUIRED" });
    const invalid = await app.request("/security/mfa/activity", {
      ...request,
      body: JSON.stringify({ activeAt: -1 }),
    });
    expect(invalid.status).toBe(400);
  });
  it("returns the MFA grant only in an HttpOnly cookie and rejects a missing origin", async () => {
    const principal = await newAdmin();
    const setup = await beginMfaEnrollment(principal);
    const app = factory
      .createApp()
      .use(async (c, next) => {
        c.set("user", { id: principal.userId, role: "admin" } as typeof c.var.user);
        c.set("session", { id: principal.sessionId } as typeof c.var.session);
        await next();
      })
      .route("/security", securityRouter);
    const request = {
      body: JSON.stringify({ code: await generate({ secret: setup.secret }), method: "totp" }),
      headers: { "content-type": "application/json", origin: "https://arc.example.invalid" },
      method: "POST",
    };
    const denied = await app.request("/security/mfa/verify", {
      ...request,
      headers: { "content-type": "application/json" },
    });
    expect(denied.status).toBe(403);
    const response = await app.request("/security/mfa/verify", request);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).toContain("Path=/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).toSorted()).toEqual(["expiresAt", "recoveryCodes"]);
    const headers = new Headers({ cookie: cookie?.split(";")[0] ?? "" });
    expect(await requireRecentMfa(principal, headers)).toBe(body.expiresAt);
  });
  it("migrates every IP copy idempotently and keeps ordinary list DTOs free of IP content", async () => {
    const { principal, headers } = await enrolledAdmin();
    const { client } = getDatabase();
    const address = "198.51.100.77";
    await client.query(
      `insert into interview_telemetry_event (id,event_key,meeting_id,organization_id,meeting_title,participant_identity,participant_name,source,type,occurred_at,ip) values ('legacy-event','legacy-event','legacy-meeting','legacy-org','Legacy','candidate','Candidate','client','page_opened',now(),$1)`,
      [address],
    );
    await client.query(
      `insert into candidate_entry_credential_use (id,credential_ref,organization_id,candidate_id,candidate_name,meeting_id,round_id,visit_id,invite_hash,proof_hash,expires_at,method,properties,ip) values ('legacy-use','credential','legacy-org','candidate','Candidate','legacy-meeting','round','visit','hash','proof',now(),'register','{}',$1)`,
      [address],
    );
    await client.exec(
      `insert into interview_media_room(room_sid,room_name,meeting_id,meeting_title,organization_id) values('legacy-room','room','legacy-meeting','Legacy','legacy-org');`,
    );
    await client.query(
      `insert into interview_media_asset(id,meeting_id,room_sid,participant_sid,participant_identity,participant_name,participant_role,kind,slot,status,captured_at,environment) values('legacy-asset','legacy-meeting','legacy-room','sid','candidate','Candidate','candidate','audio','slot','ready',now(),$1)`,
      [JSON.stringify({ ip: address, userAgent: "Retained browser" })],
    );
    await client.query(`update session set ip_address=$1 where id=$2`, [
      address,
      principal.sessionId,
    ]);
    const database = getDatabase().db as unknown as Database;
    expect(await backfillEncryptedIps(database)).toEqual({
      entryUses: 1,
      mediaSnapshots: 1,
      sessions: 1,
      telemetry: 1,
    });
    const before = await loadMeetingLog("legacy-meeting", logQuerySchema.parse({}));
    expect(JSON.stringify(before)).not.toContain(address);
    expect(before.records[0].hasIp).toBe(true);
    expect(before.participants[0].ipEventIds).toEqual(["legacy-event"]);
    expect(await backfillEncryptedIps(database, true)).toEqual({
      entryUses: 0,
      mediaSnapshots: 0,
      sessions: 0,
      telemetry: 0,
    });
    expect(await backfillEncryptedIps(database, true)).toEqual({
      entryUses: 0,
      mediaSnapshots: 0,
      sessions: 0,
      telemetry: 0,
    });
    for (const [kind, id] of [
      ["telemetry", "legacy-event"],
      ["entry-use", "legacy-use"],
      ["media", "legacy-asset"],
    ] as const) {
      expect(
        await revealStoredIp({ id, kind, meetingId: "legacy-meeting" }, principal, headers),
      ).toMatchObject({ ip: address });
    }
    const timeline = await loadMeetingLog("legacy-meeting", logQuerySchema.parse({ ip: address }));
    expect(timeline.records).toHaveLength(1);
    const dto = JSON.stringify([
      timeline,
      await loadMeetingEntryCredentials("legacy-meeting"),
      await loadMeetingMedia("legacy-meeting", { page: 1 }),
    ]);
    expect(dto).not.toContain(address);
    expect(dto).not.toContain("ip:v1:");
    expect(dto).not.toContain("ipLookupHash");
    expect(dto).toContain("Retained browser");
    const [storedSession] = await getDatabase()
      .db.select()
      .from(session)
      .where(eq(session.id, principal.sessionId));
    expect(storedSession.ipAddress).toBeNull();
    expect(storedSession.ipCiphertext).toMatch(/^ip:v1:/);
  });
  it.each([false, true])(
    "encrypts client and server event IPs with proxy trust=%s",
    async (trusted) => {
      vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", trusted ? "127.0.0.1" : "");
      const expectedIp = trusted ? "203.0.113.55" : "192.0.2.55";
      const headers = new Headers({ "x-real-ip": "203.0.113.55" });
      const scope = {
        meetingId: randomUUID(),
        meetingTitle: "Writer test",
        organizationId: "writer-org",
        participantIdentity: "candidate",
        participantName: "Candidate",
        participantRole: "candidate",
        roomName: randomUUID(),
      };
      await runWithRequestPeerIp(trusted ? "127.0.0.1" : expectedIp, async () => {
        await saveClientEvents(
          scope,
          [
            {
              clientSequence: 1,
              details: {},
              id: randomUUID(),
              occurredAt: new Date().toISOString(),
              tabId: randomUUID(),
              type: "page_opened",
              visitId: randomUUID(),
            },
          ],
          headers,
        );
        // The late-server-event path deliberately resolves the retained, encrypted telemetry scope.
        await recordServerTelemetry({ headers, roomName: scope.roomName, type: "token_issued" });
      });
      const stored = await getDatabase()
        .db.select()
        .from(events)
        .where(eq(events.meetingId, scope.meetingId));
      expect(stored).toHaveLength(2);
      expect(new Set(stored.map((row) => row.source))).toEqual(new Set(["client", "server"]));
      for (const row of stored) {
        expect(row.ip).toMatch(/^ip:v1:/);
        expect(row.ipSource).toBe(trusted ? "trusted-proxy:x-real-ip" : "direct-connection");
        expect(row.ipLookupHash).toBe(ipLookupHash(expectedIp));
        expect(
          await decryptIp(row.ip ?? "", ipContext("telemetry", scope.organizationId, row.id)),
        ).toBe(expectedIp);
      }
      expect(JSON.stringify(stored)).not.toContain(expectedIp);
    },
  );
});
