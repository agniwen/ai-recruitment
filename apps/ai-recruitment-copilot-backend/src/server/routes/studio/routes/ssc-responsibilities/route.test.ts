import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { member, organization, user } from "@arc/db-schema/schema";
import { sscResponsibilitiesRouter } from "./route";

const INPUT = {
  centerName: "尚未建档的中心",
  demandOwner: "对接负责人",
  email: "unregistered@example.com",
  notes: "负责多个部门",
  sscName: "SSC 花名",
  telegram: "@ssc_pending",
};
const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;
const organizationIds: string[] = [];
let organizationId: string;
let actorId: string;
let membershipId: string;

async function createWorkspace() {
  const id = `test_ssc_relationship_${randomUUID()}`;
  organizationIds.push(id);
  await db.insert(organization).values({ id, name: id, slug: id });
  return id;
}

function request(path = "", method = "GET", body?: unknown, scope = organizationId) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: scope, slug: scope } as never);
      c.set("user", { id: actorId } as never);
      // The route must verify actual membership; an injected role is insufficient.
      c.set("member", { organizationId: scope, role: "owner", userId: actorId } as never);
      await next();
    })
    .route("/ssc-responsibilities", sscResponsibilitiesRouter)
    .request(`/ssc-responsibilities${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    });
}

async function create(input = INPUT, scope = organizationId): Promise<string> {
  const response = await request("", "POST", input, scope);
  expect(response.status).toBe(201);
  const result = await response.json();
  return result.id;
}

async function list(query = "", scope = organizationId) {
  const response = await request(query, "GET", undefined, scope);
  expect(response.status).toBe(200);
  return await response.json();
}

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC responsibility pre-entry CRUD",
  () => {
    beforeEach(async () => {
      organizationId = await createWorkspace();
      actorId = `test_ssc_relationship_user_${randomUUID()}`;
      membershipId = randomUUID();
      await db.insert(user).values({ email: `${actorId}@example.com`, id: actorId, name: "Admin" });
      await db.insert(member).values({
        id: membershipId,
        organizationId,
        role: "owner",
        userId: actorId,
      });
    });

    afterEach(async () => {
      if (organizationIds.length > 0) {
        await db.delete(organization).where(inArray(organization.id, organizationIds.splice(0)));
      }
      if (actorId) {
        await db.delete(user).where(eq(user.id, actorId));
      }
    });

    it.each(["owner", "admin"])(
      "lets a real %s save six normalized fields for an unregistered SSC and unknown center",
      async (role) => {
        await db.update(member).set({ role }).where(eq(member.id, membershipId));
        const email = `future_ssc_${randomUUID()}@example.com`;
        const id = await create({
          centerName: "  未建立目录的中心  ",
          demandOwner: "  负责人  ",
          email: `  ${email.toUpperCase()}  `,
          notes: "  备注  ",
          sscName: "  花名  ",
          telegram: "  @pending_ssc  ",
        });
        const result = await list();
        expect(result).toEqual({
          page: 1,
          pageSize: 20,
          records: [
            {
              centerName: "未建立目录的中心",
              createdAt: expect.any(String),
              demandOwner: "负责人",
              email,
              id,
              notes: "备注",
              sscName: "花名",
              telegram: "@pending_ssc",
              updatedAt: expect.any(String),
            },
          ],
          total: 1,
          totalPages: 1,
        });
        expect(result.records[0].createdAt).toMatch(/T.*Z$/u);
        expect(result.records[0].updatedAt).toMatch(/T.*Z$/u);
        const accounts = await db.select().from(user).where(eq(user.email, email));
        expect(accounts).toHaveLength(0);
      },
    );

    it("accepts empty optional values", async () => {
      await create({ ...INPUT, demandOwner: "  ", notes: "", telegram: " " });
      await expect(list()).resolves.toMatchObject({
        records: [{ demandOwner: "", notes: "", telegram: "" }],
      });
    });

    it.each([
      { centerName: " " },
      { sscName: "" },
      { email: "not-an-email" },
      { email: "" },
      { email: undefined },
      { demandOwner: 42 },
      { notes: null },
    ])("rejects invalid fields %j before saving", async (patch) => {
      await expect(request("", "POST", { ...INPUT, ...patch })).resolves.toHaveProperty(
        "status",
        400,
      );
      await expect(list()).resolves.toHaveProperty("total", 0);
    });

    it("returns an empty paginated result", async () => {
      expect(await list()).toEqual({ page: 1, pageSize: 20, records: [], total: 0, totalPages: 1 });
    });

    it.each([
      ["centerName", "x".repeat(201)],
      ["sscName", "x".repeat(101)],
      ["demandOwner", "x".repeat(101)],
      ["telegram", "x".repeat(121)],
      ["email", `${"x".repeat(245)}@example.com`],
      ["notes", "x".repeat(4001)],
    ])("rejects an oversized %s on both create and update", async (field, value) => {
      const input = { ...INPUT, [field]: value };
      await expect(request("", "POST", input)).resolves.toHaveProperty("status", 400);
      await expect(request("/missing", "PATCH", input)).resolves.toHaveProperty("status", 400);
    });

    it("rejects an oversized search query", async () => {
      await expect(request(`?search=${"x".repeat(301)}`)).resolves.toHaveProperty("status", 400);
    });

    it("paginates and sorts within the workspace", async () => {
      const ids: string[] = [];
      for (const [centerName, sscName, email] of [
        ["Zulu", "A", "c@example.com"],
        ["Alpha", "C", "b@example.com"],
        ["Beta", "B", "a@example.com"],
      ]) {
        ids.push(await create({ ...INPUT, centerName, email, sscName }));
      }
      await db.execute(sql`
        UPDATE ssc_responsibility
        SET created_at = CASE id
          WHEN ${ids[0]} THEN '2026-01-03T00:00:00Z'::timestamptz
          WHEN ${ids[1]} THEN '2026-01-01T00:00:00Z'::timestamptz
          ELSE '2026-01-02T00:00:00Z'::timestamptz END
        WHERE organization_id = ${organizationId}
      `);
      const first = await list("?page=1&pageSize=2&sortBy=centerName&sortOrder=asc");
      expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
      expect(first.records.map((row: { centerName: string }) => row.centerName)).toEqual([
        "Alpha",
        "Beta",
      ]);
      const second = await list("?page=2&pageSize=2&sortBy=centerName&sortOrder=asc");
      expect(second.records.map((row: { centerName: string }) => row.centerName)).toEqual(["Zulu"]);
      const byName = await list("?sortBy=sscName&sortOrder=desc");
      expect(byName.records.map((row: { sscName: string }) => row.sscName)).toEqual([
        "C",
        "B",
        "A",
      ]);
      const byEmail = await list("?sortBy=email&sortOrder=asc");
      expect(byEmail.records.map((row: { email: string }) => row.email)).toEqual([
        "a@example.com",
        "b@example.com",
        "c@example.com",
      ]);
      const byCreated = await list("?sortBy=createdAt&sortOrder=desc");
      expect(byCreated.records.map((row: { centerName: string }) => row.centerName)).toEqual([
        "Zulu",
        "Beta",
        "Alpha",
      ]);
    });

    it.each(["?page=0", "?pageSize=101", "?sortBy=notes", "?sortOrder=sideways"])(
      "rejects invalid list queries: %s",
      async (query) => {
        await expect(request(query)).resolves.toHaveProperty("status", 400);
      },
    );

    it.each(["demandOwner", "centerName", "sscName", "telegram", "email", "notes"] as const)(
      "searches the %s field",
      async (field) => {
        const id = await create({
          ...INPUT,
          [field]: field === "email" ? "needle@example.com" : "needle",
        });
        await create({ ...INPUT, centerName: "Other", email: "other@example.com" });
        const result = await list("?search=needle");
        expect(result.total).toBe(1);
        expect(result.records.map((row: { id: string }) => row.id)).toEqual([id]);
      },
    );

    it.each([
      ["100%", "100% center", "100X center"],
      ["team_1", "team_1", "teamX1"],
      ["team\\1", "team\\1", "team1"],
    ])("treats search %s as literal text", async (search, matching, other) => {
      const id = await create({ ...INPUT, centerName: matching });
      await create({ ...INPUT, centerName: other });
      const result = await list(`?search=${encodeURIComponent(search)}`);
      expect(result.records.map((row: { id: string }) => row.id)).toEqual([id]);
      expect(result.total).toBe(1);
    });

    it("rejects normalized duplicates but permits multiple centers and SSCs", async () => {
      await create({ ...INPUT, centerName: "Center A" });
      await expect(
        request("", "POST", {
          ...INPUT,
          centerName: "  cENTER a ",
          email: "UNREGISTERED@EXAMPLE.COM",
        }),
      ).resolves.toHaveProperty("status", 409);
      await create({ ...INPUT, centerName: "Center B" });
      await create({ ...INPUT, centerName: "Center A", email: "second@example.com" });
      await expect(list()).resolves.toHaveProperty("total", 3);
    });

    it("rejects a concurrent duplicate save at the database boundary", async () => {
      const results = await Promise.all([
        request("", "POST", { ...INPUT, centerName: "Concurrent Center" }),
        request("", "POST", {
          ...INPUT,
          centerName: " concurrent CENTER ",
          email: "UNREGISTERED@EXAMPLE.COM",
        }),
      ]);
      expect(results.map((response) => response.status).toSorted()).toEqual([201, 409]);
      await expect(list()).resolves.toHaveProperty("total", 1);
    });

    it("updates all six fields and permits saving its own unique key again", async () => {
      const id = await create();
      const updated = {
        centerName: " Changed ",
        demandOwner: " New Owner ",
        email: "CHANGED@EXAMPLE.COM",
        notes: " New note ",
        sscName: " New SSC ",
        telegram: " @new_ssc ",
      };
      const response = await request(`/${id}`, "PATCH", updated);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id });
      await expect(request(`/${id}`, "PATCH", updated)).resolves.toHaveProperty("status", 200);
      await expect(list()).resolves.toMatchObject({
        records: [
          {
            centerName: "Changed",
            demandOwner: "New Owner",
            email: "changed@example.com",
            id,
            notes: "New note",
            sscName: "New SSC",
            telegram: "@new_ssc",
          },
        ],
      });
    });

    it("rejects a duplicate update and preserves the original record", async () => {
      await create();
      const id = await create({ ...INPUT, centerName: "Other" });
      await expect(request(`/${id}`, "PATCH", INPUT)).resolves.toHaveProperty("status", 409);
      const result = await list();
      expect(result.records.find((row: { id: string }) => row.id === id).centerName).toBe("Other");
    });

    it("validates updates and reports missing records", async () => {
      const id = await create();
      await expect(
        request(`/${id}`, "PATCH", { ...INPUT, centerName: "" }),
      ).resolves.toHaveProperty("status", 400);
      await expect(request("/missing", "PATCH", INPUT)).resolves.toHaveProperty("status", 404);
      await expect(request("/missing", "DELETE")).resolves.toHaveProperty("status", 404);
    });

    it("deletes one record and reports a repeated deletion as missing", async () => {
      const id = await create();
      const response = await request(`/${id}`, "DELETE");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      await expect(list()).resolves.toHaveProperty("total", 0);
      await expect(request(`/${id}`, "DELETE")).resolves.toHaveProperty("status", 404);
    });

    it("isolates list, duplicate keys, updates and deletes between workspaces", async () => {
      const otherOrg = await createWorkspace();
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: otherOrg, role: "owner", userId: actorId });
      const localId = await create();
      const foreignId = await create(INPUT, otherOrg);
      const local = await list();
      const foreign = await list("", otherOrg);
      expect(local.records.map((row: { id: string }) => row.id)).toEqual([localId]);
      expect(foreign.records.map((row: { id: string }) => row.id)).toEqual([foreignId]);
      await expect(request(`/${foreignId}`, "PATCH", INPUT)).resolves.toHaveProperty("status", 404);
      await expect(request(`/${foreignId}`, "DELETE")).resolves.toHaveProperty("status", 404);
      await expect(list("", otherOrg)).resolves.toHaveProperty("total", 1);
    });

    it.each(["member", "custom-ssc", "noAccess"])(
      "denies all endpoints to an actual %s even with a spoofed owner request role",
      async (role) => {
        await db.update(member).set({ role }).where(eq(member.id, membershipId));
        for (const [path, method] of [
          ["", "GET"],
          ["", "POST"],
          ["/any", "PATCH"],
          ["/any", "DELETE"],
        ]) {
          await expect(
            request(path, method, method === "GET" ? undefined : INPUT),
          ).resolves.toHaveProperty("status", 403);
        }
      },
    );

    it("denies an owner of another workspace without local membership", async () => {
      const otherOrg = await createWorkspace();
      await expect(request("", "GET", undefined, otherOrg)).resolves.toHaveProperty("status", 403);
      await expect(request("", "POST", INPUT, otherOrg)).resolves.toHaveProperty("status", 403);
    });
  },
);
