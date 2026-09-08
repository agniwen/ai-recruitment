import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  hiringUnit,
  jobDescription,
  organization,
  resumeSource,
} from "@arc/db-schema/schema";
import { createFixtureNamespace } from "../../../../../../../../test-utils/fixture-id";
import { syncGoogleSheetJobDescriptions } from "./google-sheets-sync";

const namespace = createFixtureNamespace("sheet_hierarchy");
const orgId = `${namespace}_a`;
const otherOrgId = `${namespace}_b`;
const headers = [
  "岗位唯一编码",
  "岗位名称",
  "来源表格",
  "编制组织",
  "部门",
  "岗位管控分类",
  "期望到岗日期",
  "缺口",
  "HC",
  "职级",
  "序列",
  "备注说明\n非远程岗位请备注说明工作地点",
  "已发offer待入职",
  "已到岗",
  "优先级",
  "JD(必填) 岗位职责+任职要求",
  "招聘状态",
  "提需日期",
  "需求发起人",
  "简历对接人\n (花名 & @TG)",
  "薪资范围",
  "服务单位",
  "工作地点",
];
function row(code: string, source = "来源A", unit = "技术中心", dept = "平台组") {
  return [
    code,
    "后端工程师",
    source,
    unit,
    dept,
    ...Array.from({ length: headers.length - 5 }, () => ""),
  ];
}
function sync(rows: string[][], organizationId = orgId) {
  return syncGoogleSheetJobDescriptions({
    actorRole: "admin",
    actorUserId: null,
    organizationId,
    values: [headers, ...rows],
  });
}
function hierarchy(organizationId = orgId) {
  return db
    .select({
      code: jobDescription.code,
      departmentId: department.id,
      departmentName: department.name,
      hiringUnitId: hiringUnit.id,
      sourceId: resumeSource.id,
      sourceName: resumeSource.name,
      unitName: hiringUnit.name,
    })
    .from(jobDescription)
    .innerJoin(department, eq(department.id, jobDescription.departmentId))
    .innerJoin(
      hiringUnit,
      and(
        eq(hiringUnit.id, jobDescription.hiringUnitId),
        eq(hiringUnit.id, department.hiringUnitId),
      ),
    )
    .innerJoin(resumeSource, eq(resumeSource.id, hiringUnit.resumeSourceId))
    .where(eq(jobDescription.organizationId, organizationId))
    .orderBy(jobDescription.code);
}

beforeEach(async () => {
  await db
    .insert(organization)
    .values([orgId, otherOrgId].map((id) => ({ id, name: id, slug: id })));
});
afterEach(async () => {
  for (const id of [orgId, otherOrgId]) {
    await db.delete(jobDescription).where(eq(jobDescription.organizationId, id));
    await db.delete(department).where(eq(department.organizationId, id));
    await db.delete(hiringUnit).where(eq(hiringUnit.organizationId, id));
    await db.delete(resumeSource).where(eq(resumeSource.organizationId, id));
    await db.delete(organization).where(eq(organization.id, id));
  }
});

describe("Google sheet organization hierarchy", () => {
  it("isolates identical units and departments across sources, and reuses them on repeat sync", async () => {
    const rows = [row("REQ-000001"), row("REQ-000002", "来源B"), row("REQ-000003")];
    expect(await sync(rows)).toMatchObject({
      departmentsCreated: 2,
      hiringUnitsCreated: 2,
      jobsCreated: 3,
      resumeSourcesCreated: 2,
    });
    const first = await hierarchy();
    expect(first).toHaveLength(3);
    expect(first[0].hiringUnitId).not.toBe(first[1].hiringUnitId);
    expect(first[0].departmentId).not.toBe(first[1].departmentId);
    expect(first[0].departmentId).toBe(first[2].departmentId);
    expect(await sync(rows)).toMatchObject({
      departmentsCreated: 0,
      hiringUnitsCreated: 0,
      jobsUnchanged: 3,
      jobsUpdated: 0,
      resumeSourcesCreated: 0,
    });
    expect(await hierarchy()).toEqual(first);
  });
  it("isolates same-named departments under different units of one source", async () => {
    expect(await sync([row("REQ-000001"), row("REQ-000002", "来源A", "业务中心")])).toMatchObject({
      departmentsCreated: 2,
      hiringUnitsCreated: 2,
      resumeSourcesCreated: 1,
    });
    const rows = await hierarchy();
    expect(rows[0].sourceId).toBe(rows[1].sourceId);
    expect(rows[0].departmentId).not.toBe(rows[1].departmentId);
  });
  it("does not adopt or move a pre-existing unassigned organization", async () => {
    const oldUnitId = `${namespace}_legacy_unit`;
    const oldDeptId = `${namespace}_legacy_dept`;
    await db
      .insert(hiringUnit)
      .values({ description: "保留", id: oldUnitId, name: "技术中心", organizationId: orgId });
    await db
      .insert(department)
      .values({ hiringUnitId: oldUnitId, id: oldDeptId, name: "平台组", organizationId: orgId });
    const [before] = await db.select().from(hiringUnit).where(eq(hiringUnit.id, oldUnitId));
    await sync([row("REQ-000001")]);
    const [linked] = await hierarchy();
    expect(linked.hiringUnitId).not.toBe(oldUnitId);
    expect(linked.departmentId).not.toBe(oldDeptId);
    const [after] = await db.select().from(hiringUnit).where(eq(hiringUnit.id, oldUnitId));
    expect(after).toEqual(before);
    const [job] = await db
      .select()
      .from(jobDescription)
      .where(eq(jobDescription.organizationId, orgId));
    expect(job).toMatchObject({ resumeSourceId: linked.sourceId, sourceSheet: "来源A" });
  });
  it("reuses normalized names without changing existing names or descriptions", async () => {
    const sourceId = `${namespace}_source`;
    const unitId = `${namespace}_unit`;
    const deptId = `${namespace}_dept`;
    await db
      .insert(resumeSource)
      .values({ description: "来源说明", id: sourceId, name: "来源A", organizationId: orgId });
    await db.insert(hiringUnit).values({
      description: "组织说明",
      id: unitId,
      name: "技术中心",
      organizationId: orgId,
      resumeSourceId: sourceId,
    });
    await db.insert(department).values({
      description: "部门说明",
      hiringUnitId: unitId,
      id: deptId,
      name: "平台组",
      organizationId: orgId,
    });
    const before = await Promise.all([
      db.select().from(resumeSource).where(eq(resumeSource.id, sourceId)),
      db.select().from(hiringUnit).where(eq(hiringUnit.id, unitId)),
      db.select().from(department).where(eq(department.id, deptId)),
    ]);
    expect(await sync([row("REQ-000001", " 来源Ａ ", " 技术中心 ", "平台组 ")])).toMatchObject({
      departmentsCreated: 0,
      hiringUnitsCreated: 0,
      resumeSourcesCreated: 0,
    });
    const after = await Promise.all([
      db.select().from(resumeSource).where(eq(resumeSource.id, sourceId)),
      db.select().from(hiringUnit).where(eq(hiringUnit.id, unitId)),
      db.select().from(department).where(eq(department.id, deptId)),
    ]);
    expect(after).toEqual(before);
    const [job] = await db
      .select()
      .from(jobDescription)
      .where(eq(jobDescription.organizationId, orgId));
    expect(job).toMatchObject({ resumeSourceId: sourceId, sourceSheet: "来源A" });
  });
  it("creates separate default units and departments for each source", async () => {
    await sync([row("REQ-000001", "", "", ""), row("REQ-000002", "来源B", "", "")]);
    const rows = await hierarchy();
    expect(rows[0]).toMatchObject({
      departmentName: "默认部门",
      sourceName: "默认简历来源",
      unitName: "默认用人组织",
    });
    expect(rows[1]).toMatchObject({
      departmentName: "默认部门",
      sourceName: "来源B",
      unitName: "默认用人组织",
    });
    expect(rows[0].hiringUnitId).not.toBe(rows[1].hiringUnitId);
    expect(rows[0].departmentId).not.toBe(rows[1].departmentId);
  });
  it("preserves a local department for blank cells only while the parent remains the same", async () => {
    await sync([row("REQ-000001")]);
    const [first] = await hierarchy();
    await sync([row("REQ-000001", "来源A", "技术中心", "")]);
    expect(await hierarchy()).toEqual([first]);
    await sync([row("REQ-000001", "来源B", "技术中心", "")]);
    const [moved] = await hierarchy();
    expect(moved).toMatchObject({ departmentName: "默认部门", sourceName: "来源B" });
    expect(moved.hiringUnitId).not.toBe(first.hiringUnitId);
    const [old] = await db.select().from(department).where(eq(department.id, first.departmentId));
    expect(old.hiringUnitId).toBe(first.hiringUnitId);
  });
  it("keeps workspaces isolated even for an identical entire hierarchy", async () => {
    await sync([row("REQ-000001")]);
    await sync([row("REQ-000001")], otherOrgId);
    const [a] = await hierarchy();
    const [b] = await hierarchy(otherOrgId);
    expect(a.sourceId).not.toBe(b.sourceId);
    expect(a.hiringUnitId).not.toBe(b.hiringUnitId);
    expect(a.departmentId).not.toBe(b.departmentId);
  });
  it("does not delete organization nodes when a row disappears from Google", async () => {
    await sync([row("REQ-000001")]);
    const before = await hierarchy();
    await sync([]);
    expect(await hierarchy()).toEqual(before);
    const [job] = await db
      .select()
      .from(jobDescription)
      .where(eq(jobDescription.organizationId, orgId));
    expect(job.googleSheetDeleted).toBe(true);
  });
});
