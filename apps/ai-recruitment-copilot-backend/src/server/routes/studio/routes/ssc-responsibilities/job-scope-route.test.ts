import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  department,
  hiringUnit,
  jobDescription,
  member,
  organization,
  organizationRole,
  resumeSource,
  user,
} from "@arc/db-schema/schema";
import { sscResponsibilitiesRouter } from "./route";
import { departmentsRouter } from "../departments/route";

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
  input: typeof INPUT & {
    resumeSourceId?: string | null;
    workspaceRole?: string;
    departmentId?: string | null;
    serviceUnit?: string | null;
  } = INPUT,
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

async function responseStatus(response: Promise<Response> | Response) {
  const result = await response;
  return result.status;
}

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC responsibility job-scope CRUD",
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

    it("saves restrictions, preserves omitted restrictions, and explicitly clears them", async () => {
      const departmentId = randomUUID();
      await db.insert(department).values({ id: departmentId, name: "制作部", organizationId });
      const id = await create({ ...INPUT, departmentId, serviceUnit: " Sinema " });
      expect(await list()).toMatchObject({
        records: [{ departmentId, departmentName: "制作部", id, serviceUnit: "Sinema" }],
      });
      expect(
        await responseStatus(request(`/${id}`, "PATCH", { ...INPUT, notes: "Contact updated" })),
      ).toBe(200);
      expect(await list()).toMatchObject({
        records: [{ departmentId, id, serviceUnit: "Sinema" }],
      });
      expect(
        await responseStatus(
          request(`/${id}`, "PATCH", { ...INPUT, departmentId: "", serviceUnit: " " }),
        ),
      ).toBe(200);
      expect(await list()).toMatchObject({
        records: [{ departmentId: null, departmentName: null, id, serviceUnit: null }],
      });
    });

    it("rejects foreign and missing department restrictions without saving", async () => {
      const foreignOrg = await createWorkspace();
      const departmentId = randomUUID();
      await db
        .insert(department)
        .values({ id: departmentId, name: "Foreign", organizationId: foreignOrg });
      for (const value of [departmentId, "missing-department"]) {
        expect(await responseStatus(request("", "POST", { ...INPUT, departmentId: value }))).toBe(
          400,
        );
      }
      expect(await list()).toHaveProperty("total", 0);
    });

    it("allows separate job scopes for one SSC but rejects normalized duplicate scopes", async () => {
      const departmentId = randomUUID();
      await db.insert(department).values({ id: departmentId, name: "制作部", organizationId });
      await create({ ...INPUT, departmentId, serviceUnit: "Sinema" });
      await create({ ...INPUT, departmentId, serviceUnit: "Other" });
      await create({ ...INPUT, departmentId: null, serviceUnit: "Sinema" });
      expect(
        await responseStatus(
          request("", "POST", { ...INPUT, departmentId, serviceUnit: " sinema " }),
        ),
      ).toBe(409);
      expect(await list()).toHaveProperty("total", 3);
    });

    it("offers only local departments and canonical distinct service-unit suggestions", async () => {
      const hiringUnitId = randomUUID();
      const departmentId = randomUUID();
      await db.insert(hiringUnit).values({ id: hiringUnitId, name: "渠道中心", organizationId });
      await db
        .insert(department)
        .values({ hiringUnitId, id: departmentId, name: "制作部", organizationId });
      await db.insert(jobDescription).values([
        {
          departmentId,
          id: randomUUID(),
          name: "A",
          organizationId,
          prompt: "test",
          serviceUnit: " Sinema ",
        },
        {
          departmentId,
          id: randomUUID(),
          name: "B",
          organizationId,
          prompt: "test",
          serviceUnit: "Sinema",
        },
        {
          departmentId,
          id: randomUUID(),
          name: "C",
          organizationId,
          prompt: "test",
          serviceUnit: " ",
        },
      ]);
      const foreignOrg = await createWorkspace();
      await db
        .insert(department)
        .values({ id: randomUUID(), name: "Foreign", organizationId: foreignOrg });
      const response = await request("/options");
      expect(await response.json()).toMatchObject({
        departments: [{ hiringUnitName: "渠道中心", id: departmentId, name: "制作部" }],
        serviceUnits: ["Sinema"],
      });
    });

    it("refuses to delete a department referenced only by an SSC restriction", async () => {
      const departmentId = randomUUID();
      await db.insert(department).values({ id: departmentId, name: "制作部", organizationId });
      const id = await create({ ...INPUT, departmentId });
      const response = await factory
        .createApp()
        .use("*", async (c, next) => {
          c.set("activeOrg", { id: organizationId, slug: organizationId } as never);
          c.set("user", { id: actorId } as never);
          c.set("member", { organizationId, role: "owner", userId: actorId } as never);
          await next();
        })
        .route("/departments", departmentsRouter)
        .request(`/departments/${departmentId}`, { method: "DELETE" });
      expect(response.status).toBe(409);
      expect(await list()).toMatchObject({ records: [{ departmentId, id }] });
    });
  },
);
