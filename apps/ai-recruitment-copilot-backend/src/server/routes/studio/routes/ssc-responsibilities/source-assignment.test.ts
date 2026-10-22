import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  department,
  member,
  organization,
  organizationRole,
  resumeSource,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { sscResponsibilitiesRouter } from "./route";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;
const organizations: string[] = [];
const users: string[] = [];
let organizationId: string;
let actorId: string;
let actorMemberId: string;
let sourceA: string;
let sourceB: string;

async function workspace() {
  const id = `test_ssc_source_${randomUUID()}`;
  organizations.push(id);
  await db.insert(organization).values({ id, name: id, slug: id });
  await db.insert(organizationRole).values({
    id: randomUUID(),
    isSsc: true,
    name: "SSC 审核",
    organizationId: id,
    permission: "{}",
    role: "ssc-role",
  });
  return id;
}

async function account(
  role: string | null,
  options: { email?: string; banned?: boolean; scope?: string } = {},
) {
  const id = randomUUID();
  const email = options.email ?? `${id}@example.com`;
  const memberId = randomUUID();
  users.push(id);
  await db.insert(user).values({
    banned: options.banned ?? false,
    email,
    id,
    name: "Existing SSC",
    telegram: "@existing",
  });
  if (role) {
    await db
      .insert(member)
      .values({ id: memberId, organizationId: options.scope ?? organizationId, role, userId: id });
  }
  return { email, id, memberId };
}

async function preentry(email: string, patch: Partial<typeof sscResponsibility.$inferInsert> = {}) {
  const id = patch.id ?? randomUUID();
  await db.insert(sscResponsibility).values({
    centerName: `Original ${id}`,
    email,
    id,
    organizationId,
    sscName: "Pre-entry SSC",
    telegram: "@pending",
    workspaceRole: "ssc-role",
    ...patch,
  });
  return id;
}

function request(path: string, method = "GET", body?: unknown) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: organizationId, slug: organizationId } as never);
      c.set("user", { id: actorId } as never);
      c.set("member", { organizationId, role: "owner", userId: actorId } as never);
      await next();
    })
    .route("/ssc", sscResponsibilitiesRouter)
    .request(`/ssc${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    });
}

async function candidates(sourceId = sourceA) {
  const response = await request(`/candidates?resumeSourceId=${encodeURIComponent(sourceId)}`);
  expect(response.status).toBe(200);
  const payload = await response.json();
  return payload.candidates as {
    id: string;
    email: string;
    registered: boolean;
    assigned: boolean;
    telegram: string;
    workspaceRole: string;
  }[];
}

function assignments() {
  return db
    .select()
    .from(sscResponsibility)
    .where(
      and(
        eq(sscResponsibility.organizationId, organizationId),
        eq(sscResponsibility.resumeSourceId, sourceA),
      ),
    );
}

async function responseStatus(response: Promise<Response> | Response) {
  const result = await response;
  return result.status;
}

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC source assignment",
  () => {
    beforeEach(async () => {
      organizationId = await workspace();
      const actor = await account("owner");
      actorId = actor.id;
      actorMemberId = actor.memberId;
      sourceA = randomUUID();
      sourceB = randomUUID();
      await db.insert(resumeSource).values([
        { id: sourceA, name: "Exact Source", organizationId },
        { id: sourceB, name: "Exact Source suffix", organizationId },
      ]);
    });

    afterEach(async () => {
      await db.delete(organization).where(inArray(organization.id, organizations.splice(0)));
      await db.delete(user).where(inArray(user.id, users.splice(0)));
    });

    it("checks assigned identities only within the selected source and job restrictions", async () => {
      const entry = await account("ssc-role");
      const departmentId = randomUUID();
      await db.insert(department).values({ id: departmentId, name: "制作部", organizationId });
      const payload = {
        candidateIds: [`member:${entry.memberId}`],
        departmentId,
        resumeSourceId: sourceA,
        serviceUnit: "Sinema",
      };
      expect(await responseStatus(request("/assign", "POST", payload))).toBe(201);
      const same = await request(
        `/candidates?resumeSourceId=${sourceA}&departmentId=${departmentId}&serviceUnit=sinema`,
      );
      expect(await same.json()).toMatchObject({
        candidates: [{ assigned: true, id: `member:${entry.memberId}` }],
      });
      expect(
        await responseStatus(request("/assign", "POST", { ...payload, serviceUnit: " sinema " })),
      ).toBe(409);
      expect(
        await responseStatus(request("/assign", "POST", { ...payload, serviceUnit: "Other" })),
      ).toBe(201);
      expect(
        await responseStatus(
          request("/assign", "POST", {
            candidateIds: payload.candidateIds,
            resumeSourceId: sourceA,
          }),
        ),
      ).toBe(201);
      expect(await assignments()).toHaveLength(3);
    });

    it("does not broaden a cloned restricted preentry when assignment scope is omitted", async () => {
      const departmentId = randomUUID();
      await db.insert(department).values({ id: departmentId, name: "制作部", organizationId });
      const original = await preentry("future@example.com", {
        departmentId,
        resumeSourceId: sourceB,
        serviceUnit: "Sinema",
      });
      const response = await request("/assign", "POST", {
        candidateIds: [`responsibility:${original}`],
        resumeSourceId: sourceA,
      });
      expect(response.status).toBe(201);
      expect(await assignments()).toMatchObject([{ departmentId, serviceUnit: "Sinema" }]);
    });

    it("rejects a foreign source-assignment department without partial writes", async () => {
      const entry = await account("ssc-role");
      const foreignOrg = await workspace();
      const departmentId = randomUUID();
      await db
        .insert(department)
        .values({ id: departmentId, name: "Foreign", organizationId: foreignOrg });
      expect(
        await responseStatus(
          request("/assign", "POST", {
            candidateIds: [`member:${entry.memberId}`],
            departmentId,
            resumeSourceId: sourceA,
          }),
        ),
      ).toBe(400);
      expect(await assignments()).toHaveLength(0);
    });

    it("filters the ledger by exact source ID independently of text search", async () => {
      const first = await preentry("first@example.com", { resumeSourceId: sourceA });
      await preentry("second@example.com", { resumeSourceId: sourceB });
      await preentry("pending@example.com");
      const response = await request(`?resumeSourceId=${sourceA}`);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.total).toBe(1);
      expect(result.records.map((row: { id: string }) => row.id)).toEqual([first]);
    });

    it("combines eligible members and unregistered SSC intentions once per canonical email", async () => {
      const registered = await account("ssc-role");
      await preentry(registered.email, { resumeSourceId: sourceA });
      const pending = await preentry("future@example.com");
      await preentry(" FUTURE@EXAMPLE.COM ", { resumeSourceId: sourceB });
      await preentry("", { sscName: "Missing email" });
      const list = await candidates();
      expect(list).toHaveLength(2);
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assigned: true,
            email: registered.email,
            id: `member:${registered.memberId}`,
            registered: true,
            workspaceRole: "ssc-role",
          }),
          expect.objectContaining({
            assigned: false,
            email: "future@example.com",
            registered: false,
            workspaceRole: "ssc-role",
          }),
        ]),
      );
      expect(list.find((row) => row.email === "future@example.com")?.id).toMatch(
        /^responsibility:/,
      );
      const refreshed = await candidates();
      expect(refreshed.map((row) => row.id)).toEqual(list.map((row) => row.id));
      const [original] = await db
        .select()
        .from(sscResponsibility)
        .where(eq(sscResponsibility.id, pending));
      expect(original.resumeSourceId).toBeNull();
    });

    it("excludes registered non-SSC, protected, banned, ambiguous and foreign accounts even with stale preentries", async () => {
      for (const role of ["member", "admin", "owner", "noAccess", null]) {
        const entry = await account(role);
        await preentry(entry.email);
      }
      const banned = await account("ssc-role", { banned: true });
      await preentry(banned.email);
      const ambiguous = await account("ssc-role");
      await account("ssc-role", { email: ambiguous.email.toUpperCase() });
      await preentry(ambiguous.email);
      const foreign = await workspace();
      const foreignAccount = await account("ssc-role", { scope: foreign });
      await preentry(foreignAccount.email);
      await preentry("no-role@example.com", { workspaceRole: null });
      expect(await candidates()).toEqual([]);
    });

    it("retains a registered member's ledger Telegram when assigning another source without changing their profile", async () => {
      const email = `${randomUUID()}@example.com`;
      const originalId = await preentry(` ${email.toUpperCase()} `, {
        resumeSourceId: sourceB,
        telegram: " @Ledger_Ssc ",
      });
      const registered = await account("ssc-role", { email });
      await db
        .update(user)
        .set({
          telegram: null,
          telegramBoundUsername: "preserved_binding",
          telegramChatId: "987654321",
        })
        .where(eq(user.id, registered.id));
      const [profileBefore] = await db.select().from(user).where(eq(user.id, registered.id));
      const [originalBefore] = await db
        .select()
        .from(sscResponsibility)
        .where(eq(sscResponsibility.id, originalId));

      expect(await candidates()).toMatchObject([
        {
          assigned: false,
          id: `member:${registered.memberId}`,
          registered: true,
          telegram: "@ledger_ssc",
        },
      ]);
      const response = await request("/assign", "POST", {
        candidateIds: [`member:${registered.memberId}`],
        resumeSourceId: sourceA,
      });
      expect(response.status).toBe(201);
      expect(await assignments()).toMatchObject([{ email, telegram: "@ledger_ssc" }]);
      const [profileAfter] = await db.select().from(user).where(eq(user.id, registered.id));
      expect(profileAfter).toEqual(profileBefore);
      const [originalAfter] = await db
        .select()
        .from(sscResponsibility)
        .where(eq(sscResponsibility.id, originalId));
      expect(originalAfter).toEqual(originalBefore);
    });

    it("keeps an existing personal Telegram ahead of a different ledger contact", async () => {
      const registered = await account("ssc-role");
      await preentry(registered.email, { resumeSourceId: sourceB, telegram: "@ledger_ssc" });
      expect(await candidates()).toMatchObject([
        { id: `member:${registered.memberId}`, telegram: "@existing" },
      ]);
    });

    it("does not guess between conflicting ledger Telegram contacts for a registered member", async () => {
      const registered = await account("ssc-role");
      await db.update(user).set({ telegram: " " }).where(eq(user.id, registered.id));
      await preentry(registered.email, { resumeSourceId: sourceB, telegram: "@first_ssc" });
      await preentry(registered.email, { telegram: "@second_ssc" });
      expect(await candidates()).toMatchObject([
        { id: `member:${registered.memberId}`, telegram: "" },
      ]);
    });

    it("does not use another workspace's ledger Telegram for an unfilled local member profile", async () => {
      const registered = await account("ssc-role");
      await db.update(user).set({ telegram: null }).where(eq(user.id, registered.id));
      const foreign = await workspace();
      await preentry(registered.email, { organizationId: foreign, telegram: "@foreign_ssc" });
      expect(await candidates()).toMatchObject([
        { id: `member:${registered.memberId}`, telegram: "" },
      ]);
    });

    it("copies a batch into the same ledger without moving original preentries or changing profiles", async () => {
      const registered = await account("ssc-role");
      const originalId = await preentry("future@example.com", {
        notes: "Preserve original",
        resumeSourceId: sourceB,
      });
      const [before] = await db
        .select()
        .from(sscResponsibility)
        .where(eq(sscResponsibility.id, originalId));
      const [profileBefore] = await db.select().from(user).where(eq(user.id, registered.id));
      const response = await request("/assign", "POST", {
        candidateIds: [`member:${registered.memberId}`, `responsibility:${originalId}`],
        resumeSourceId: sourceA,
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ added: 2 });
      expect(await assignments()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            centerName: "Exact Source",
            email: registered.email,
            sscName: "Existing SSC",
            telegram: "@existing",
            workspaceRole: "ssc-role",
          }),
          expect.objectContaining({
            centerName: "Exact Source",
            email: "future@example.com",
            sscName: "Pre-entry SSC",
            telegram: "@pending",
            workspaceRole: "ssc-role",
          }),
        ]),
      );
      const [after] = await db
        .select()
        .from(sscResponsibility)
        .where(eq(sscResponsibility.id, originalId));
      expect(after).toEqual(before);
      const [profileAfter] = await db.select().from(user).where(eq(user.id, registered.id));
      expect(profileAfter).toEqual(profileBefore);
    });

    it("rejects a mixed batch when one candidate became stale without adding the valid candidate", async () => {
      const first = await account("ssc-role");
      const second = await account("ssc-role");
      expect(await candidates()).toHaveLength(2);
      await db.update(member).set({ role: "member" }).where(eq(member.id, second.memberId));
      const response = await request("/assign", "POST", {
        candidateIds: [`member:${first.memberId}`, `member:${second.memberId}`],
        resumeSourceId: sourceA,
      });
      expect(response.status).toBe(409);
      expect(await assignments()).toEqual([]);
    });

    it("rejects newly registered non-SSC preentries instead of overriding their membership", async () => {
      const id = await preentry("future@example.com");
      expect(await candidates()).toHaveLength(1);
      const existing = await account("member", { email: "future@example.com" });
      const response = await request("/assign", "POST", {
        candidateIds: [`responsibility:${id}`],
        resumeSourceId: sourceA,
      });
      expect(response.status).toBe(409);
      const [unchanged] = await db.select().from(member).where(eq(member.id, existing.memberId));
      expect(unchanged.role).toBe("member");
      expect(await assignments()).toEqual([]);
    });

    it("rejects existing assignments and duplicate candidate IDs atomically", async () => {
      const first = await account("ssc-role");
      const second = await account("ssc-role");
      await preentry(first.email, { resumeSourceId: sourceA });
      const ids = [`member:${first.memberId}`, `member:${second.memberId}`];
      await expect(
        request("/assign", "POST", { candidateIds: ids, resumeSourceId: sourceA }),
      ).resolves.toHaveProperty("status", 409);
      await expect(
        request("/assign", "POST", { candidateIds: [ids[1], ids[1]], resumeSourceId: sourceA }),
      ).resolves.toHaveProperty("status", 409);
      expect(await assignments()).toHaveLength(1);
    });

    it("rejects invalid or foreign sources and candidate IDs without writes", async () => {
      const entry = await account("ssc-role");
      const foreignOrg = await workspace();
      const foreignSource = randomUUID();
      await db
        .insert(resumeSource)
        .values({ id: foreignSource, name: "Foreign", organizationId: foreignOrg });
      await expect(request(`/candidates?resumeSourceId=${foreignSource}`)).resolves.toHaveProperty(
        "status",
        400,
      );
      await expect(
        request("/assign", "POST", {
          candidateIds: [`member:${entry.memberId}`],
          resumeSourceId: foreignSource,
        }),
      ).resolves.toHaveProperty("status", 400);
      await expect(
        request("/assign", "POST", { candidateIds: ["member:missing"], resumeSourceId: sourceA }),
      ).resolves.toHaveProperty("status", 409);
      await expect(
        request("/assign", "POST", { candidateIds: [], resumeSourceId: sourceA }),
      ).resolves.toHaveProperty("status", 400);
      expect(await assignments()).toEqual([]);
    });

    it("denies new endpoints to a non-admin despite an injected owner role", async () => {
      await db.update(member).set({ role: "ssc-role" }).where(eq(member.id, actorMemberId));
      await expect(request(`/candidates?resumeSourceId=${sourceA}`)).resolves.toHaveProperty(
        "status",
        403,
      );
      await expect(
        request("/assign", "POST", { candidateIds: ["member:any"], resumeSourceId: sourceA }),
      ).resolves.toHaveProperty("status", 403);
    });

    it("keeps an unregistered candidate ID stable after adding another source relationship", async () => {
      const id = await preentry("future@example.com", {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        id: `z_original_${organizationId}`,
      });
      const [before] = await candidates();
      expect(before.id).toBe(`responsibility:${id}`);
      await expect(
        request("/assign", "POST", { candidateIds: [before.id], resumeSourceId: sourceA }),
      ).resolves.toHaveProperty("status", 201);
      const [after] = await candidates(sourceB);
      expect(after.id).toBe(before.id);
    });

    it("serializes concurrent assignments so the duplicate batch cannot create a second ledger row", async () => {
      const entry = await account("ssc-role");
      const payload = { candidateIds: [`member:${entry.memberId}`], resumeSourceId: sourceA };
      const responses = await Promise.all([
        request("/assign", "POST", payload),
        request("/assign", "POST", payload),
      ]);
      expect(responses.map((response) => response.status).toSorted()).toEqual([201, 409]);
      expect(await assignments()).toHaveLength(1);
    });

    it("does not choose between contradictory SSC role intentions for the same email", async () => {
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "Other SSC",
        organizationId,
        permission: "{}",
        role: "other-ssc",
      });
      await preentry("future@example.com");
      await preentry(" FUTURE@EXAMPLE.COM ", { workspaceRole: "other-ssc" });
      expect(await candidates()).toEqual([]);
    });
  },
);
