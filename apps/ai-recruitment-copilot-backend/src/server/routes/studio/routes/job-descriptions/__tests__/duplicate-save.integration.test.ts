/* oxlint-disable unicorn/no-await-expression-member -- keep integration assertions next to the database queries they verify. */
import { jobDescriptionsRouter } from "../route";
import { and, eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  department,
  jobDescription,
  member,
  organization,
  resumeSource,
  user,
} from "@arc/db-schema/schema";
import { JOB_DESCRIPTION_DUPLICATE_CODE } from "@arc/shared/job-descriptions";
import type { JobDescriptionFormValues } from "@arc/shared/job-descriptions";
import { createDefaultResumeScreeningPolicy } from "@arc/shared/resume-screening";
import { getJobDescriptionDuplicateSnapshot } from "../utils/job-description-duplicate";
import { syncGoogleSheetJobDescriptions } from "../routes/google-sheet-sync/utils/google-sheets-sync";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue", () => ({
  deleteJobDescriptionSemanticIndexBestEffort: vi.fn(),
  enqueueJobDescriptionIndexJobBestEffort: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

const testUrl = process.env.JOB_DUPLICATE_TEST_DATABASE_URL;
const prefix = `duplicate_${crypto.randomUUID()}`;
const orgId = `${prefix}_org`;
const otherOrgId = `${prefix}_other`;
const userId = `${prefix}_user`;
const deptId = `${prefix}_dept`;
const sourceId = `${prefix}_source`;
const body: JobDescriptionFormValues = {
  aiInterviewDisabled: true,
  allowCrossDepartmentInterviewers: false,
  departmentId: deptId,
  description: "",
  humanInterviewerIds: [],
  interviewerIds: [],
  manuallyInactive: false,
  name: "前端工程师",
  priority: "P0",
  prompt: "负责前端开发",
  requester: "需求人",
  resumeContact: "对接人",
  resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
  resumeSourceId: sourceId,
  serviceUnit: "服务单位A",
  sourceSheet: "来源A",
};
const client = testClient(
  factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: orgId } as never);
      c.set("user", { id: userId } as never);
      c.set("member", { role: "owner" } as never);
      await next();
    })
    .route("/jobs", jobDescriptionsRouter),
);

const jobs = () => db.select().from(jobDescription).where(eq(jobDescription.organizationId, orgId));
async function create(
  overrides: Partial<JobDescriptionFormValues> & { forceSaveDuplicate?: boolean } = {},
) {
  const response = await client.jobs.$post({ json: { ...body, ...overrides } });
  const payload = await response.json();
  return { payload, response };
}
async function createId(overrides: Partial<JobDescriptionFormValues> = {}) {
  const result = await create(overrides);
  expect(result.response.status).toBe(201);
  if (!("id" in result.payload)) {
    throw new Error(JSON.stringify(result.payload));
  }
  return result.payload.id;
}
function update(
  id: string,
  overrides: Partial<JobDescriptionFormValues> & { forceSaveDuplicate?: boolean } = {},
) {
  return client.jobs[":id"].$patch({ json: { ...body, ...overrides }, param: { id } });
}

describe.skipIf(!testUrl)("job duplicate save with PostgreSQL and real CRUD routes", () => {
  beforeAll(async () => {
    if (
      !testUrl ||
      testUrl !== process.env.DATABASE_URL ||
      !new URL(testUrl).pathname.startsWith("/arc_job_duplicate_test_")
    ) {
      throw new Error(
        "Use an isolated arc_job_duplicate_test_* database with the application schema",
      );
    }
    await db.insert(user).values({ email: `${prefix}@example.test`, id: userId, name: "测试运营" });
    await db.insert(organization).values([
      { createdAt: new Date(), id: orgId, name: "重复测试", slug: orgId },
      { createdAt: new Date(), id: otherOrgId, name: "其他空间", slug: otherOrgId },
    ]);
    await db
      .insert(member)
      .values({ id: `${prefix}_member`, organizationId: orgId, role: "owner", userId });
    await db.insert(department).values([
      { id: deptId, name: "研发部", organizationId: orgId },
      { id: `${deptId}_other`, name: "设计部", organizationId: orgId },
    ]);
    await db.insert(resumeSource).values({ id: sourceId, name: "来源A", organizationId: orgId });
  });
  beforeEach(async () => {
    await db.delete(jobDescription).where(eq(jobDescription.organizationId, orgId));
    await db.delete(jobDescription).where(eq(jobDescription.organizationId, otherOrgId));
  });
  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(organization).where(eq(organization.id, otherOrgId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("warns without writing; force save persists a snapshot only on the new row", async () => {
    const firstId = await createId();
    const [first] = await jobs();
    expect(first.duplicateAtSave).toBe(false);
    expect(first.duplicateCheckedAt).toBeInstanceOf(Date);
    const rejected = await create();
    expect(rejected.response.status).toBe(409);
    expect(rejected.payload).toMatchObject({ code: JOB_DESCRIPTION_DUPLICATE_CODE });
    expect(await jobs()).toHaveLength(1);
    const forced = await create({ forceSaveDuplicate: true });
    expect(forced.response.status).toBe(201);
    expect(forced.payload).not.toHaveProperty("duplicateAtSave");
    const rows = await jobs();
    expect(rows.find((row) => row.id === firstId)?.duplicateAtSave).toBe(false);
    expect(rows.find((row) => row.id !== firstId)?.duplicateAtSave).toBe(true);
  });

  it.each([
    "name",
    "departmentId",
    "serviceUnit",
    "sourceSheet",
    "requester",
    "resumeContact",
  ] as const)("requires the %s field to match as well", async (field) => {
    await createId();
    const snapshot = await db.transaction((tx) =>
      getJobDescriptionDuplicateSnapshot(
        tx,
        {
          ...body,
          [field]: `${body[field]}不同`,
        },
        orgId,
      ),
    );
    expect(snapshot.duplicateAtSave).toBe(false);
  });

  it("does not match another workspace", async () => {
    await createId();
    const snapshot = await db.transaction((tx) =>
      getJobDescriptionDuplicateSnapshot(tx, body, otherOrgId),
    );
    expect(snapshot.duplicateAtSave).toBe(false);
  });

  it("trims spaces and treats null and empty optional fields as equal", async () => {
    const id = await createId();
    await db
      .update(jobDescription)
      .set({
        name: ` ${body.name} `,
        requester: "",
        resumeContact: " ",
        serviceUnit: null,
        sourceSheet: null,
      })
      .where(eq(jobDescription.id, id));
    const result = await create({
      requester: null,
      resumeContact: null,
      resumeSourceId: null,
      serviceUnit: "",
      sourceSheet: "",
    });
    expect(result.response.status).toBe(409);
    expect(result.payload).toMatchObject({ code: JOB_DESCRIPTION_DUPLICATE_CODE });
  });

  it("excludes self during edit and recalculates after editing a duplicate away", async () => {
    const firstId = await createId();
    expect((await update(firstId)).status).toBe(200);
    const secondId = await createId({ name: "设计师" });
    expect((await update(secondId)).status).toBe(409);
    expect((await jobs()).find((row) => row.id === secondId)?.name).toBe("设计师");
    expect((await update(secondId, { forceSaveDuplicate: true })).status).toBe(200);
    expect((await jobs()).find((row) => row.id === secondId)?.duplicateAtSave).toBe(true);
    expect((await update(secondId, { name: "新岗位" })).status).toBe(200);
    expect((await jobs()).every((row) => row.duplicateAtSave === false)).toBe(true);
  });

  it("rechecks force save instead of trusting an earlier conflict or the force flag", async () => {
    const firstId = await createId();
    expect((await create()).response.status).toBe(409);
    await db.delete(jobDescription).where(eq(jobDescription.id, firstId));
    expect((await create({ forceSaveDuplicate: true })).response.status).toBe(201);
    expect((await jobs())[0].duplicateAtSave).toBe(false);
  });

  it("serializes concurrent equal creates so only one saves without confirmation", async () => {
    const results = await Promise.all([create(), create()]);
    expect(results.map((result) => result.response.status).toSorted()).toEqual([201, 409]);
    expect(await jobs()).toHaveLength(1);
  });

  it("includes inactive records and does not backfill legacy or peer snapshots", async () => {
    const id = await createId();
    await db
      .update(jobDescription)
      .set({
        duplicateAtSave: null,
        duplicateCheckedAt: null,
        googleSheetDeleted: true,
        manuallyInactive: true,
      })
      .where(eq(jobDescription.id, id));
    expect((await create()).response.status).toBe(409);
    expect((await create({ forceSaveDuplicate: true })).response.status).toBe(201);
    const rows = await jobs();
    expect(rows.find((row) => row.id === id)).toMatchObject({
      duplicateAtSave: null,
      duplicateCheckedAt: null,
    });
    const duplicate = rows.find((row) => row.id !== id);
    if (!duplicate) {
      throw new Error("Expected saved duplicate");
    }
    await db.delete(jobDescription).where(eq(jobDescription.id, id));
    expect((await jobs())[0].duplicateAtSave).toBe(true);
    expect((await update(duplicate.id)).status).toBe(200);
    expect((await jobs())[0].duplicateAtSave).toBe(false);
  });

  it("keeps Google sync automatic, flags equal rows, and preserves unchanged snapshots", async () => {
    const headers = [
      "岗位唯一编码",
      "岗位名称",
      "来源表格",
      "编制组织",
      "部门",
      "服务单位",
      "需求发起人",
      "简历对接人\n (花名 & @TG)",
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
      "薪资范围",
      "工作地点",
    ];
    const values = [
      headers,
      ["REQ-000001", "研发工程师", "来源A", "技术中心", "平台组", "单位A", "发起人", "联系人"],
      ["REQ-000002", "研发工程师", "来源A", "技术中心", "平台组", "单位A", "发起人", "联系人"],
    ];
    const sync = () =>
      syncGoogleSheetJobDescriptions({
        actorRole: "owner",
        actorUserId: userId,
        organizationId: orgId,
        values,
      });
    expect((await sync()).jobsCreated).toBe(2);
    const rows = await jobs();
    expect(rows.find((row) => row.code === "REQ-000001")?.duplicateAtSave).toBe(false);
    expect(rows.find((row) => row.code === "REQ-000002")?.duplicateAtSave).toBe(true);
    expect((await sync()).jobsUnchanged).toBe(2);
    expect((await jobs()).find((row) => row.code === "REQ-000002")?.duplicateCheckedAt).toEqual(
      rows.find((row) => row.code === "REQ-000002")?.duplicateCheckedAt,
    );
    values[2][1] = "不同岗位";
    expect((await sync()).jobsUpdated).toBe(1);
    const [changed] = await db
      .select()
      .from(jobDescription)
      .where(and(eq(jobDescription.organizationId, orgId), eq(jobDescription.code, "REQ-000002")));
    expect(changed.duplicateAtSave).toBe(false);
  });
});
