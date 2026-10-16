import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { generate } from "otplib";
import { eq } from "drizzle-orm";
import { account, platformMfaFactor, session, user } from "@arc/db-schema/schema";
import type { auth as Authentication } from "./auth";
import { installSecurityTestKeys } from "../../test-utils/security-keys";
import { createSecurityTestDatabase } from "../../test-utils/security-database";
import { beginMfaEnrollment, verifyMfa } from "../../server/routes/security/mfa/service";
import { MFA_COOKIE } from "../../server/routes/security/mfa/policy";

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
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/pre-registrations/provisioning",
  () => ({ provisionPreRegisteredUser: vi.fn() }),
);
let auth: typeof Authentication;
beforeAll(async () => {
  installSecurityTestKeys();
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-auth-secret-with-more-than-32-characters");
  vi.stubEnv("BETTER_AUTH_URL", "https://arc.example.invalid");
  for (const name of [
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_APP_ID2",
    "FEISHU_APP_SECRET2",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ]) {
    vi.stubEnv(name, "isolated-test");
  }
  state.database = await createSecurityTestDatabase();
  ({ auth } = await import("./auth"));
});
afterAll(async () => {
  await state.database?.client.close();
  vi.unstubAllEnvs();
});
describe("Better Auth IP persistence and native admin boundary", () => {
  it("keeps ordinary account sign-in available without binding a platform authenticator", async () => {
    const id = randomUUID();
    const email = `${id}@example.invalid`;
    const password = "Test-only-normal-user!123";
    await getDatabase().db.insert(user).values({ email, id, name: "Ordinary user", role: "user" });
    await getDatabase()
      .db.insert(account)
      .values({
        accountId: id,
        id: randomUUID(),
        password: await hashPassword(password),
        providerId: "credential",
        userId: id,
      });
    const response = await auth.api.signInEmail({
      asResponse: true,
      body: { email, password },
      headers: new Headers({
        origin: "https://arc.example.invalid",
        "x-forwarded-for": "203.0.113.13",
      }),
    });
    expect(response.status).toBe(200);
    expect(
      await getDatabase()
        .db.select()
        .from(platformMfaFactor)
        .where(eq(platformMfaFactor.userId, id)),
    ).toHaveLength(0);
  });
  it("encrypts on sign-in, hides the encrypted field, and enforces MFA on native admin APIs", async () => {
    const id = randomUUID();
    const email = `${id}@example.invalid`;
    const password = "A-test-only-password!123";
    await getDatabase().db.insert(user).values({ email, id, name: "Admin", role: "admin" });
    await getDatabase()
      .db.insert(account)
      .values({
        accountId: id,
        id: randomUUID(),
        password: await hashPassword(password),
        providerId: "credential",
        userId: id,
      });
    const headers = new Headers({
      origin: "https://arc.example.invalid",
      "x-forwarded-for": "203.0.113.12",
    });
    const response = await auth.api.signInEmail({
      asResponse: true,
      body: { email, password },
      headers,
    });
    expect(response.status).toBe(200);
    const cookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    headers.set("cookie", cookies);
    const [stored] = await getDatabase().db.select().from(session).where(eq(session.userId, id));
    expect(stored.ipAddress).toBeNull();
    expect(stored.ipCiphertext).toMatch(/^ip:v1:/);
    const sessionResponse = await auth.api.getSession({ asResponse: true, headers });
    const serialized = await sessionResponse.text();
    expect(serialized).not.toContain("203.0.113.12");
    expect(serialized).not.toContain("ip:v1:");
    expect(serialized).not.toContain("ipCiphertext");
    headers.set("content-type", "application/json");
    const denied = await auth.handler(
      new Request("https://arc.example.invalid/api/auth/admin/list-user-sessions", {
        body: JSON.stringify({ userId: id }),
        headers,
        method: "POST",
      }),
    );
    expect(denied.status).toBe(403);
    const principal = { sessionId: stored.id, userId: id };
    const setup = await beginMfaEnrollment(principal);
    const result = await verifyMfa(principal, {
      code: await generate({ secret: setup.secret }),
      method: "totp",
    });
    headers.set("cookie", `${cookies}; ${MFA_COOKIE}=${result.token}`);
    const allowed = await auth.handler(
      new Request("https://arc.example.invalid/api/auth/admin/list-user-sessions", {
        body: JSON.stringify({ userId: id }),
        headers,
        method: "POST",
      }),
    );
    expect(allowed.status).toBe(200);
    const body = await allowed.text();
    expect(body).not.toContain("203.0.113.12");
    expect(body).not.toContain("ip:v1:");
    expect(body).not.toContain("ipCiphertext");
  });
});
