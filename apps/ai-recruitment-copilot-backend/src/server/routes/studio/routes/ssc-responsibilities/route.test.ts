import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  member,
  organization,
  organizationRole,
  resumeSource,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
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
const sourceIds = new Map<string, Promise<string>>();

function source(name: string, scope = organizationId) {
  const key = `${scope}:${name.trim().toLowerCase()}`;
  const existing = sourceIds.get(key);
  if (existing) {
    return existing;
  }
  const id = randomUUID();
  const created = db
    .insert(resumeSource)
    .values({ id, name: name.trim(), organizationId: scope })
    .then(() => id);
  sourceIds.set(key, created);
  return created;
}

async function createWorkspace() {
  const id = `test_ssc_relationship_${randomUUID()}`;
  organizationIds.push(id);
  await db.insert(organization).values({ id, name: id, slug: id });
  await db.insert(organizationRole).values({
    id: randomUUID(),
    isSsc: true,
    name: "SSC 角色",
    organizationId: id,
    permission: "{}",
    role: "custom-ssc",
  });
  return id;
}

async function request(path = "", method = "GET", body?: unknown, scope = organizationId) {
  let payload = body;
  if ((method === "POST" || method === "PATCH") && body && typeof body === "object") {
    const fields = body as Record<string, unknown>;
    const validCenter =
      typeof fields.centerName === "string" &&
      fields.centerName.trim().length > 0 &&
      fields.centerName.length <= 200;
    payload = {
      resumeSourceId: validCenter
        ? await source(fields.centerName as string, scope)
        : await source("Default Center", scope),
      workspaceRole: "custom-ssc",
      ...fields,
    };
  }
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
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method,
    });
}

async function create(
  input: typeof INPUT & { resumeSourceId?: string | null; workspaceRole?: string } = INPUT,
  scope = organizationId,
): Promise<string> {
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
      "lets a real %s save normalized fields for an unregistered SSC and linked center",
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
        expect(result).toMatchObject({
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
              resumeSourceId: expect.any(String),
              resumeSourceName: "未建立目录的中心",
              sscName: "花名",
              telegram: "@pending_ssc",
              updatedAt: expect.any(String),
              workspaceRole: "custom-ssc",
              workspaceRoleName: "SSC 角色",
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

    it("lists only current-workspace SSC roles and sources as options", async () => {
      const localSource = await source("Local Center");
      const otherOrg = await createWorkspace();
      await source("Foreign Center", otherOrg);
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isOdc: true,
        name: "ODC Role",
        organizationId,
        permission: "{}",
        role: "odc-only",
      });
      const response = await request("/options");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resumeSources: [{ id: localSource, name: "Local Center" }],
        roles: [{ label: "SSC 角色", value: "custom-ssc" }],
      });
    });

    it.each([null, "missing"])("rejects an unlinked new center: %s", async (resumeSourceId) => {
      await expect(request("", "POST", { ...INPUT, resumeSourceId })).resolves.toHaveProperty(
        "status",
        400,
      );
      await expect(list()).resolves.toHaveProperty("total", 0);
    });

    it.each(["admin", "owner", "member", "unknown", "odc-only"])(
      "rejects non-SSC or unknown role %s",
      async (workspaceRole) => {
        await db.insert(organizationRole).values({
          id: randomUUID(),
          isOdc: true,
          name: "ODC Role",
          organizationId,
          permission: "{}",
          role: "odc-only",
        });
        await expect(request("", "POST", { ...INPUT, workspaceRole })).resolves.toHaveProperty(
          "status",
          400,
        );
        await expect(list()).resolves.toHaveProperty("total", 0);
      },
    );

    it("rejects a role or source belonging to another workspace", async () => {
      const otherOrg = await createWorkspace();
      const foreignSource = await source("Foreign Center", otherOrg);
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "Foreign SSC",
        organizationId: otherOrg,
        permission: "{}",
        role: "foreign-ssc",
      });
      await expect(
        request("", "POST", { ...INPUT, resumeSourceId: foreignSource }),
      ).resolves.toHaveProperty("status", 400);
      await expect(
        request("", "POST", { ...INPUT, workspaceRole: "foreign-ssc" }),
      ).resolves.toHaveProperty("status", 400);
    });

    it("uses the selected source name and shows a source rename immediately", async () => {
      const resumeSourceId = await source("Real Center");
      const id = await create({ ...INPUT, centerName: "Spoofed Center", resumeSourceId });
      await expect(list()).resolves.toMatchObject({
        records: [{ centerName: "Real Center", id, resumeSourceName: "Real Center" }],
      });
      await db
        .update(resumeSource)
        .set({ name: "Renamed Center" })
        .where(eq(resumeSource.id, resumeSourceId));
      await expect(list("?search=Renamed")).resolves.toMatchObject({
        records: [{ id, resumeSourceId, resumeSourceName: "Renamed Center" }],
        total: 1,
      });
      await expect(
        request("", "POST", { ...INPUT, centerName: "Different Text", resumeSourceId }),
      ).resolves.toHaveProperty("status", 409);
      await expect(
        request(`/${id}`, "PATCH", { ...INPUT, resumeSourceId: null }),
      ).resolves.toHaveProperty("status", 400);
    });

    it("preserves legacy unlinked rows and their raw center until explicitly linked", async () => {
      const id = randomUUID();
      await db.insert(sscResponsibility).values({ ...INPUT, id, organizationId });
      await expect(list()).resolves.toMatchObject({
        records: [{ id, resumeSourceId: null, resumeSourceName: null, workspaceRole: null }],
      });
      await expect(
        request(`/${id}`, "PATCH", { ...INPUT, notes: "Updated", resumeSourceId: null }),
      ).resolves.toHaveProperty("status", 200);
      await expect(
        request(`/${id}`, "PATCH", { ...INPUT, centerName: "Invented", resumeSourceId: null }),
      ).resolves.toHaveProperty("status", 400);
      await expect(list()).resolves.toMatchObject({
        records: [{ centerName: INPUT.centerName, id, notes: "Updated", resumeSourceId: null }],
      });
    });

    it("rejects different SSC role assignments for the same email without partial changes", async () => {
      const id = await create();
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "Second SSC Role",
        organizationId,
        permission: "{}",
        role: "ssc-second",
      });
      await expect(
        request("", "POST", { ...INPUT, centerName: "Other", workspaceRole: "ssc-second" }),
      ).resolves.toHaveProperty("status", 400);
      await expect(list()).resolves.toMatchObject({
        records: [{ id, workspaceRole: "custom-ssc" }],
        total: 1,
      });
    });

    it("syncs an existing ordinary member role without changing their profile", async () => {
      const userId = `test_ssc_target_${randomUUID()}`;
      const targetMemberId = randomUUID();
      const email = `${userId}@example.com`;
      try {
        await db
          .insert(user)
          .values({ email, id: userId, name: "Existing Name", telegram: "@existing" });
        await db
          .insert(member)
          .values({ id: targetMemberId, organizationId, role: "member", userId });
        await create({ ...INPUT, email });
        const [target] = await db.select().from(member).where(eq(member.id, targetMemberId));
        expect(target.role).toBe("custom-ssc");
        const [profile] = await db.select().from(user).where(eq(user.id, userId));
        expect(profile).toMatchObject({ email, name: "Existing Name", telegram: "@existing" });
      } finally {
        await db.delete(user).where(eq(user.id, userId));
      }
    });

    it("preserves an administrator membership when their email appears in SSC pre-entry", async () => {
      await create({ ...INPUT, email: `${actorId}@example.com` });
      const [administrator] = await db.select().from(member).where(eq(member.id, membershipId));
      expect(administrator.role).toBe("owner");
    });

    it("rolls back the record when the target member is explicitly restricted", async () => {
      const userId = `test_ssc_restricted_${randomUUID()}`;
      try {
        const email = `${userId}@example.com`;
        await db.insert(user).values({ email, id: userId, name: "Restricted" });
        await db
          .insert(member)
          .values({ id: randomUUID(), organizationId, role: "noAccess", userId });
        await expect(request("", "POST", { ...INPUT, email })).resolves.toHaveProperty(
          "status",
          400,
        );
        await expect(list()).resolves.toHaveProperty("total", 0);
        const id = await create();
        await expect(
          request(`/${id}`, "PATCH", { ...INPUT, email, notes: "Must roll back" }),
        ).resolves.toHaveProperty("status", 400);
        await expect(list()).resolves.toMatchObject({
          records: [{ email: INPUT.email, id, notes: INPUT.notes }],
          total: 1,
        });
      } finally {
        await db.delete(user).where(eq(user.id, userId));
      }
    });

    it.each([{ sscName: "" }, { email: "" }])(
      "accepts missing SSC information %j",
      async (patch) => {
        const id = await create({ ...INPUT, ...patch });
        await expect(list()).resolves.toMatchObject({ records: [{ id, ...patch }] });
      },
    );

    it("pre-enters a center when all five other fields are blank", async () => {
      const id = await create({
        centerName: "  待分配中心  ",
        demandOwner: " ",
        email: " ",
        notes: " ",
        sscName: " ",
        telegram: " ",
      });
      await expect(list()).resolves.toMatchObject({
        records: [
          {
            centerName: "待分配中心",
            demandOwner: "",
            email: "",
            id,
            notes: "",
            sscName: "",
            telegram: "",
          },
        ],
      });
    });

    it("keeps different named SSCs at the same center when their email and TG are blank", async () => {
      await create({ ...INPUT, email: "", sscName: "Alice", telegram: "" });
      await create({ ...INPUT, email: "", sscName: "Bob", telegram: "" });
      await expect(list()).resolves.toHaveProperty("total", 2);
    });

    it("uses TG before name and email before TG when choosing a duplicate identity", async () => {
      await create({ ...INPUT, email: "", sscName: "Same Name", telegram: "@first" });
      await create({ ...INPUT, email: "", sscName: "Same Name", telegram: "@second" });
      await expect(
        request("", "POST", {
          ...INPUT,
          email: "",
          sscName: "Different Name",
          telegram: " @FIRST ",
        }),
      ).resolves.toHaveProperty("status", 409);
      await create({
        ...INPUT,
        email: "filled@example.com",
        sscName: "Same Name",
        telegram: "@first",
      });
      await expect(list()).resolves.toHaveProperty("total", 3);
    });

    it("keeps the email, TG, name and unassigned identity namespaces distinct", async () => {
      await create({ ...INPUT, email: "", sscName: "", telegram: "shared" });
      await create({ ...INPUT, email: "", sscName: "shared", telegram: "" });
      await create({ ...INPUT, email: "", sscName: "", telegram: "" });
      await create({ ...INPUT, email: "", sscName: "unassigned", telegram: "" });
      await create({ ...INPUT, email: "shared@example.com", sscName: "", telegram: "" });
      await create({ ...INPUT, email: "", sscName: "", telegram: "shared@example.com" });
      await expect(list()).resolves.toHaveProperty("total", 6);
    });

    it.each([
      [
        "telegram",
        { email: "", sscName: "First", telegram: " @Pending " },
        { email: "", sscName: "Second", telegram: "@PENDING" },
      ],
      [
        "name",
        { email: "", sscName: " Alice ", telegram: "" },
        { email: " ", sscName: "ALICE", telegram: " " },
      ],
      [
        "unassigned",
        { email: "", sscName: "", telegram: "" },
        { email: " ", sscName: " ", telegram: " " },
      ],
    ] as const)(
      "rejects concurrent normalized %s fallback identities",
      async (_kind, first, second) => {
        const responses = await Promise.all([
          request("", "POST", { ...INPUT, ...first, centerName: " Fallback Center " }),
          request("", "POST", { ...INPUT, ...second, centerName: "fallback CENTER" }),
        ]);
        expect(responses.map((response) => response.status).toSorted()).toEqual([201, 409]);
        await expect(list()).resolves.toHaveProperty("total", 1);
      },
    );

    it("fills in an email and rejects conflicts when moving between identity types", async () => {
      const alice = { ...INPUT, email: "", sscName: "Alice", telegram: "" };
      const bob = { ...INPUT, email: "", sscName: "Bob", telegram: "" };
      const aliceId = await create(alice);
      const bobId = await create(bob);
      await expect(
        request(`/${aliceId}`, "PATCH", { ...alice, email: " FILLED@EXAMPLE.COM " }),
      ).resolves.toHaveProperty("status", 200);
      await expect(
        request(`/${bobId}`, "PATCH", { ...bob, email: "filled@example.com" }),
      ).resolves.toHaveProperty("status", 409);
      await create(alice);
      await expect(request(`/${aliceId}`, "PATCH", alice)).resolves.toHaveProperty("status", 409);
      const result = await list();
      expect(result.records.find((row: { id: string }) => row.id === aliceId).email).toBe(
        "filled@example.com",
      );
      expect(result.records.find((row: { id: string }) => row.id === bobId).email).toBe("");
    });

    it.each([
      { centerName: " " },
      { email: "not-an-email" },
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
          ["/options", "GET"],
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
