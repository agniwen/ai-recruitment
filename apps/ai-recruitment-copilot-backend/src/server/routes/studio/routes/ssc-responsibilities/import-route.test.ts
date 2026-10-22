import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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
let organizationId: string;
let actorId: string;
let membershipId: string;
const extraUsers: string[] = [];
const blankRow = {
  centerName: "未建中心",
  demandOwner: "",
  email: "",
  notes: "",
  row: 2,
  sscName: "",
  telegram: "",
};
function request(path: string, body: unknown) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: organizationId, slug: organizationId } as never);
      c.set("user", { id: actorId } as never);
      c.set("member", { organizationId, role: "owner", userId: actorId } as never);
      await next();
    })
    .route("/ssc", sscResponsibilitiesRouter)
    .request(`/ssc/${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
}
type ImportRow = typeof blankRow & { departmentName?: string; serviceUnit?: string };
async function preview(rows: ImportRow[], workspaceRole = "custom-ssc") {
  const response = await request("preview", { rows, workspaceRole });
  expect(response.status).toBe(200);
  return response.json();
}
async function commit(rows: ImportRow[], workspaceRole = "custom-ssc", hash?: string) {
  const prepared = hash ? { previewHash: hash } : await preview(rows, workspaceRole);
  return request("import", { previewHash: prepared.previewHash, rows, workspaceRole });
}
function records() {
  return db
    .select()
    .from(sscResponsibility)
    .where(eq(sscResponsibility.organizationId, organizationId));
}

async function responseStatus(response: Promise<Response> | Response) {
  const result = await response;
  return result.status;
}

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "SSC responsibility import",
  () => {
    beforeEach(async () => {
      organizationId = `test_ssc_import_${randomUUID()}`;
      actorId = `test_ssc_import_user_${randomUUID()}`;
      membershipId = randomUUID();
      await db
        .insert(organization)
        .values({ id: organizationId, name: organizationId, slug: organizationId });
      await db.insert(organizationRole).values({
        id: randomUUID(),
        isSsc: true,
        name: "SSC 角色",
        organizationId,
        permission: "{}",
        role: "custom-ssc",
      });
      await db.insert(user).values({ email: `${actorId}@example.com`, id: actorId, name: "Admin" });
      await db
        .insert(member)
        .values({ id: membershipId, organizationId, role: "owner", userId: actorId });
    });
    afterEach(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [actorId, ...extraUsers.splice(0)]));
    });

    it("persists resolved restrictions and includes scope changes in confirmation hash", async () => {
      const departmentId = randomUUID();
      await db.insert(department).values({ id: departmentId, name: "制作部", organizationId });
      const rows = [{ ...blankRow, departmentName: " 制作部 ", serviceUnit: " Sinema " }];
      const prepared = await preview(rows);
      expect(prepared.rows[0]).toMatchObject({
        departmentName: "制作部",
        input: { departmentId, serviceUnit: "Sinema" },
        status: "new",
      });
      expect(
        await responseStatus(
          commit([{ ...rows[0], serviceUnit: "Other" }], "custom-ssc", prepared.previewHash),
        ),
      ).toBe(409);
      expect(await records()).toHaveLength(0);
      expect(await responseStatus(commit(rows, "custom-ssc", prepared.previewHash))).toBe(200);
      expect(await records()).toMatchObject([{ departmentId, serviceUnit: "Sinema" }]);
    });

    it("rejects a newly ambiguous department between import preview and commit", async () => {
      await db.insert(department).values({ id: randomUUID(), name: "制作部", organizationId });
      const rows = [{ ...blankRow, departmentName: "制作部" }];
      const prepared = await preview(rows);
      await db.insert(department).values({ id: randomUUID(), name: "制作部", organizationId });
      expect(await responseStatus(commit(rows, "custom-ssc", prepared.previewHash))).toBe(409);
      expect(await records()).toHaveLength(0);
    });

    it("previews without writing then imports matched and pending rows, skipping repeats after a fresh preview", async () => {
      await db.insert(resumeSource).values({ id: randomUUID(), name: "COE", organizationId });
      const rows = [
        { ...blankRow, centerName: "COE", email: "NEW@EXAMPLE.COM", sscName: "林风" },
        { ...blankRow, row: 3 },
      ];
      const prepared = await preview(rows);
      expect(prepared).toMatchObject({
        rows: [
          {
            input: { email: "new@example.com", resumeSourceId: expect.any(String) },
            status: "new",
          },
          { input: { centerName: "未建中心", resumeSourceId: null }, status: "new" },
        ],
      });
      await expect(records()).resolves.toHaveLength(0);
      const response = await commit(rows, "custom-ssc", prepared.previewHash);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ added: 2, skipped: 0 });
      await expect(records()).resolves.toHaveLength(2);
      const repeated = await commit(rows);
      expect(await repeated.json()).toMatchObject({ added: 0, skipped: 2 });
    });

    it("rejects changed source associations between preview and confirmation", async () => {
      const rows = [blankRow];
      const prepared = await preview(rows);
      expect(prepared.rows[0].input.resumeSourceId).toBeNull();
      await db
        .insert(resumeSource)
        .values({ id: randomUUID(), name: blankRow.centerName, organizationId });
      const response = await commit(rows, "custom-ssc", prepared.previewHash);
      expect(response.status).toBe(409);
      await expect(records()).resolves.toHaveLength(0);
    });

    it("imports nothing when a row or SSC role is invalid", async () => {
      const invalid = await commit([
        blankRow,
        { ...blankRow, centerName: "Other", email: "bad-email", row: 3 },
      ]);
      expect(invalid.status).toBe(409);
      const invalidRole = await commit([blankRow], "owner");
      expect(invalidRole.status).toBe(409);
      await expect(records()).resolves.toHaveLength(0);
    });

    it("revalidates a role removed after preview and rejects non-admin imports", async () => {
      const rows = [blankRow];
      const prepared = await preview(rows);
      await db
        .update(organizationRole)
        .set({ isSsc: false })
        .where(eq(organizationRole.organizationId, organizationId));
      const invalid = await commit(rows, "custom-ssc", prepared.previewHash);
      expect(invalid.status).toBe(409);
      await expect(records()).resolves.toHaveLength(0);
      await db.update(member).set({ role: "custom-ssc" }).where(eq(member.id, membershipId));
      const deniedPreview = await request("preview", { rows, workspaceRole: "custom-ssc" });
      const deniedImport = await request("import", {
        previewHash: prepared.previewHash,
        rows,
        workspaceRole: "custom-ssc",
      });
      expect(deniedPreview.status).toBe(403);
      expect(deniedImport.status).toBe(403);
    });

    it("rolls back the entire import when a matched member has noAccess", async () => {
      const blockedId = `blocked_${randomUUID()}`;
      extraUsers.push(blockedId);
      const email = `${blockedId}@example.com`;
      await db.insert(user).values({ email, id: blockedId, name: "Blocked" });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId, role: "noAccess", userId: blockedId });
      const response = await commit([blankRow, { ...blankRow, centerName: "Two", email, row: 3 }]);
      expect(response.status).toBe(409);
      await expect(records()).resolves.toHaveLength(0);
      const [unchanged] = await db.select().from(member).where(eq(member.userId, blockedId));
      expect(unchanged.role).toBe("noAccess");
    });
  },
);
