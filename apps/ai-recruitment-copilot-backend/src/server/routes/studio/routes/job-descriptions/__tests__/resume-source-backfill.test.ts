import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, jobDescription, organization, resumeSource } from "@arc/db-schema/schema";
import { createFixtureNamespace } from "../../../../../../test-utils/fixture-id";

const ns = createFixtureNamespace("source_backfill");
const orgA = `${ns}_a`;
const orgB = `${ns}_b`;
const migration = readFileSync(
  new URL(
    "../../../../../../../../ai-recruitment-copilot/drizzle/20260908130000_job_resume_source/migration.sql",
    import.meta.url,
  ),
  "utf-8",
);
afterEach(async () => {
  for (const id of [orgA, orgB]) {
    await db.delete(jobDescription).where(eq(jobDescription.organizationId, id));
    await db.delete(department).where(eq(department.organizationId, id));
    await db.delete(resumeSource).where(eq(resumeSource.organizationId, id));
    await db.delete(organization).where(eq(organization.id, id));
  }
});
describe("job source backfill", () => {
  it("reuses maintained sources, creates missing sources per workspace, and is idempotent", async () => {
    for (const id of [orgA, orgB]) {
      await db.insert(organization).values({ id, name: id, slug: id });
      await db.insert(department).values({ id: `${id}_dept`, name: "部门", organizationId: id });
    }
    await db.insert(resumeSource).values({
      description: "保留配置",
      id: `${ns}_maintained`,
      name: "来源A",
      organizationId: orgA,
    });
    await db.insert(jobDescription).values([
      {
        departmentId: `${orgA}_dept`,
        id: `${ns}_1`,
        name: "岗位1",
        organizationId: orgA,
        prompt: "JD",
        sourceSheet: " 来源Ａ ",
      },
      {
        departmentId: `${orgA}_dept`,
        id: `${ns}_2`,
        name: "岗位2",
        organizationId: orgA,
        prompt: "JD",
        sourceSheet: "新增来源",
      },
      {
        departmentId: `${orgB}_dept`,
        id: `${ns}_3`,
        name: "岗位3",
        organizationId: orgB,
        prompt: "JD",
        sourceSheet: "来源A",
      },
      {
        departmentId: `${orgA}_dept`,
        id: `${ns}_4`,
        name: "岗位4",
        organizationId: orgA,
        prompt: "JD",
        sourceSheet: null,
      },
    ]);
    const apply = () =>
      db.transaction(async (tx) => {
        for (const statement of migration.split("--> statement-breakpoint")) {
          await tx.execute(sql.raw(statement));
        }
      });
    await apply();
    const rows = await db
      .select()
      .from(jobDescription)
      .where(eq(jobDescription.organizationId, orgA))
      .orderBy(jobDescription.id);
    expect(rows[0]).toMatchObject({
      departmentId: `${orgA}_dept`,
      resumeSourceId: `${ns}_maintained`,
      sourceSheet: "来源A",
    });
    expect(rows[1].resumeSourceId).toBeTruthy();
    expect(rows[2].resumeSourceId).toBeNull();
    const [other] = await db
      .select()
      .from(jobDescription)
      .where(eq(jobDescription.organizationId, orgB));
    expect(other.resumeSourceId).not.toBe(`${ns}_maintained`);
    const [maintained] = await db
      .select()
      .from(resumeSource)
      .where(and(eq(resumeSource.organizationId, orgA), eq(resumeSource.id, `${ns}_maintained`)));
    expect(maintained.description).toBe("保留配置");
    await apply();
    expect(
      await db
        .select()
        .from(jobDescription)
        .where(eq(jobDescription.organizationId, orgA))
        .orderBy(jobDescription.id),
    ).toEqual(rows);
    expect(
      await db.select().from(resumeSource).where(eq(resumeSource.organizationId, orgA)),
    ).toHaveLength(2);
  });
});
