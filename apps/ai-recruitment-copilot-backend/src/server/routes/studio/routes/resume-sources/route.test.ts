import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  department,
  jobDescription,
  organization,
  resumeSource,
  sscResponsibility,
} from "@arc/db-schema/schema";
import { createFixtureNamespace } from "../../../../../test-utils/fixture-id";
import { resumeSourcesRouter } from "./route";

vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => factory.createMiddleware(async (_c, next) => await next()),
}));
const org = createFixtureNamespace("source_link_api");
const sourceId = `${org}_source`;
const jobId = `${org}_job`;
const app = factory
  .createApp()
  .use("*", async (c, next) => {
    c.set("activeOrg", {
      createdAt: new Date(),
      id: org,
      logo: null,
      metadata: null,
      name: org,
      slug: org,
    });
    return await next();
  })
  .route("/sources", resumeSourcesRouter);
afterEach(async () => {
  await db.delete(sscResponsibility).where(eq(sscResponsibility.organizationId, org));
  await db.delete(jobDescription).where(eq(jobDescription.organizationId, org));
  await db.delete(department).where(eq(department.organizationId, org));
  await db.delete(resumeSource).where(eq(resumeSource.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org));
});
describe("resume source job references", () => {
  it("rejects deletion when pending SSC identities would conflict and preserves both records", async () => {
    await db.insert(organization).values({ id: org, name: org, slug: org });
    await db.insert(resumeSource).values({ id: sourceId, name: "Center A", organizationId: org });
    await db.insert(sscResponsibility).values([
      {
        centerName: "Center A",
        email: "same@example.com",
        id: `${org}_pending`,
        organizationId: org,
        resumeSourceId: null,
        sscName: "SSC",
      },
      {
        centerName: "Center A",
        email: "same@example.com",
        id: `${org}_linked`,
        organizationId: org,
        resumeSourceId: sourceId,
        sscName: "SSC",
      },
    ]);
    const before = await db
      .select()
      .from(sscResponsibility)
      .where(eq(sscResponsibility.organizationId, org));
    const response = await app.request(`/sources/${sourceId}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "请先调整该部门/中心对应的 SSC 关系，避免与未关联记录重复，再删除。",
    });
    const after = await db
      .select()
      .from(sscResponsibility)
      .where(eq(sscResponsibility.organizationId, org));
    expect(after.toSorted((left, right) => left.id.localeCompare(right.id))).toEqual(
      before.toSorted((left, right) => left.id.localeCompare(right.id)),
    );
    await expect(
      db.select().from(resumeSource).where(eq(resumeSource.id, sourceId)),
    ).resolves.toHaveLength(1);
  });

  it("renames display text without changing the permission ID and blocks deleting an in-use source", async () => {
    await db.insert(organization).values({ id: org, name: org, slug: org });
    await db.insert(resumeSource).values({ id: sourceId, name: "原来源", organizationId: org });
    const sscId = `${org}_ssc`;
    await db.insert(sscResponsibility).values({
      centerName: "原始表格中心",
      demandOwner: "Owner",
      email: "ssc@example.com",
      id: sscId,
      notes: "Keep notes",
      organizationId: org,
      resumeSourceId: sourceId,
      sscName: "SSC",
      telegram: "@ssc",
    });
    await db.insert(department).values({ id: `${org}_dept`, name: "部门", organizationId: org });
    await db.insert(jobDescription).values({
      departmentId: `${org}_dept`,
      id: jobId,
      name: "岗位",
      organizationId: org,
      prompt: "JD",
      resumeSourceId: sourceId,
      sourceSheet: "原来源",
    });
    const response = await app.request(`/sources/${sourceId}`, {
      body: JSON.stringify({ name: "新来源名称" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    const [job] = await db.select().from(jobDescription).where(eq(jobDescription.id, jobId));
    expect(job).toMatchObject({ resumeSourceId: sourceId, sourceSheet: "新来源名称" });
    const blocked = await app.request(`/sources/${sourceId}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    const [retained] = await db
      .select()
      .from(sscResponsibility)
      .where(eq(sscResponsibility.id, sscId));
    expect(retained.resumeSourceId).toBe(sourceId);
    await db
      .update(jobDescription)
      .set({ resumeSourceId: null, sourceSheet: null })
      .where(eq(jobDescription.id, jobId));
    const deleted = await app.request(`/sources/${sourceId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const [pending] = await db
      .select()
      .from(sscResponsibility)
      .where(eq(sscResponsibility.id, sscId));
    expect(pending).toMatchObject({
      centerName: "原始表格中心",
      demandOwner: "Owner",
      email: "ssc@example.com",
      id: sscId,
      notes: "Keep notes",
      resumeSourceId: null,
      sscName: "SSC",
      telegram: "@ssc",
      workspaceRole: null,
    });
  });
});
