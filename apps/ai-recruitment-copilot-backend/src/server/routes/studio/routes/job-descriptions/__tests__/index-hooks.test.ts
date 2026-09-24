// 中文：验证 JD 建/改/删路由钩子确实调用了语义索引 best-effort 帮助函数
// （id/org 参数正确）。钩子内部吞错、永不抛，因此这里只断言"被调用"，不测试
// "钩子抛错时 CRUD 仍成功"——那是不可达场景，由 A6 的吞错测试覆盖。
// English: Assert the JD create/update/delete route hooks actually invoke the
// semantic-index best-effort helpers with the correct id/org. The helpers
// swallow internally and never throw, so we only assert "was called" here —
// "hook throws but CRUD still succeeds" is unreachable and is covered by A6's
// own swallow tests.

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  interviewer,
  jobDescription,
  member,
  organization,
  user,
} from "@arc/db-schema/schema";
import { createDefaultResumeScreeningPolicy } from "@arc/shared/resume-screening";
import type { JobDescriptionFormValues } from "@arc/shared/job-descriptions";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

const mocks = vi.hoisted(() => ({
  deleteJobDescriptionSemanticIndexBestEffort: vi.fn(),
  enqueueJobDescriptionIndexJobBestEffort: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue", () => ({
  deleteJobDescriptionSemanticIndexBestEffort: mocks.deleteJobDescriptionSemanticIndexBestEffort,
  enqueueJobDescriptionIndexJobBestEffort: mocks.enqueueJobDescriptionIndexJobBestEffort,
}));

// requirePermission 依赖真实 workspace request context（headers/session/DB）
// 才能解析，测试里绕开鉴权，改由外层 middleware 直接注入 activeOrg/user。
// requirePermission needs a real workspace request context (headers/session/
// DB) to resolve; bypass it in tests and inject activeOrg/user directly via
// an outer middleware instead.
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { jobDescriptionsRouter } from "../route";

const ORG_ID = "index_hooks_org";
const USER_ID = "index_hooks_user";
const DEPARTMENT_ID = "index_hooks_department";
const INTERVIEWER_ID = "index_hooks_interviewer";
const EXISTING_JD_ID = "index_hooks_existing_jd";
const NOW = new Date("2026-06-01T00:00:00.000Z");

function makeApp() {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: ORG_ID } as never);
      c.set("user", { id: USER_ID } as never);
      await next();
    })
    .route("/job-descriptions", jobDescriptionsRouter);
}

const client = testClient(makeApp());

async function cleanup() {
  await db.delete(jobDescription).where(eq(jobDescription.organizationId, ORG_ID));
  await db.delete(interviewer).where(eq(interviewer.organizationId, ORG_ID));
  await db.delete(department).where(eq(department.organizationId, ORG_ID));
  await db.delete(organization).where(eq(organization.id, ORG_ID));
  await db.delete(user).where(eq(user.id, USER_ID));
}

async function seedFixtures() {
  await db.insert(user).values({
    createdAt: NOW,
    email: "index-hooks@example.com",
    emailVerified: false,
    id: USER_ID,
    name: "李四",
    updatedAt: NOW,
  });
  await db.insert(organization).values({
    createdAt: NOW,
    id: ORG_ID,
    name: "钩子测试公司",
    slug: "index-hooks-org",
  });
  await db.insert(member).values({
    id: "index_hooks_member",
    organizationId: ORG_ID,
    role: "owner",
    userId: USER_ID,
  });
  await db.insert(department).values({
    createdAt: NOW,
    createdBy: USER_ID,
    id: DEPARTMENT_ID,
    name: "研发部",
    organizationId: ORG_ID,
    updatedAt: NOW,
  });
  await db.insert(interviewer).values({
    createdAt: NOW,
    createdBy: USER_ID,
    departmentId: DEPARTMENT_ID,
    id: INTERVIEWER_ID,
    name: "面试官甲",
    organizationId: ORG_ID,
    prompt: "请评估候选人的技术能力。",
    updatedAt: NOW,
    voice: "voice_agent_Male_Phone_1",
  });
}

function jobDescriptionPayload(
  overrides?: Partial<JobDescriptionFormValues>,
): JobDescriptionFormValues {
  return {
    aiInterviewDisabled: false,
    allowCrossDepartmentInterviewers: true,
    departmentId: DEPARTMENT_ID,
    description: "",
    humanInterviewerIds: [],
    interviewerIds: [INTERVIEWER_ID],
    manuallyInactive: false,
    name: "前端工程师",
    priority: "P0",
    prompt: "负责前端工程化与业务开发。",
    resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
    ...overrides,
  };
}

beforeEach(async () => {
  await cleanup();
  await seedFixtures();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("job-descriptions route index hooks", () => {
  it("filters list totals and exports by effective validity", async () => {
    const base = {
      allowCrossDepartmentInterviewers: true,
      createdAt: NOW,
      createdBy: USER_ID,
      departmentId: DEPARTMENT_ID,
      organizationId: ORG_ID,
      prompt: "负责岗位工作。",
      resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
      resumeScreeningPolicyVersion: 1,
      updatedAt: NOW,
    };
    await db.insert(jobDescription).values([
      { ...base, googleSheetDeleted: false, id: "valid_job", name: "有效岗位" },
      {
        ...base,
        googleSheetDeleted: false,
        id: "manual_inactive_job",
        manuallyInactive: true,
        name: "手动失效岗位",
      },
      {
        ...base,
        googleSheetDeleted: true,
        id: "deleted_sheet_job",
        name: "表格已删除岗位",
      },
    ]);

    const inactiveResponse = await client["job-descriptions"].$get({
      query: { validityStatus: "inactive" },
    });
    expect(inactiveResponse.status).toBe(200);
    const inactiveBody = await inactiveResponse.json();
    if (!("records" in inactiveBody)) {
      throw new Error("expected paginated job description records");
    }
    expect(inactiveBody.total).toBe(2);
    expect(inactiveBody.records.map((record) => record.id).toSorted()).toEqual([
      "deleted_sheet_job",
      "manual_inactive_job",
    ]);

    const activeResponse = await client["job-descriptions"].$get({
      query: { validityStatus: "active" },
    });
    const activeBody = await activeResponse.json();
    if (!("records" in activeBody)) {
      throw new Error("expected paginated job description records");
    }
    expect(activeBody.total).toBe(1);
    expect(activeBody.records.map((record) => record.id)).toEqual(["valid_job"]);

    const exportResponse = await client["job-descriptions"].export.$get({
      query: { googleSheetStatus: "active", validityStatus: "inactive" },
    });
    const exportBody = await exportResponse.json();
    if (!("records" in exportBody)) {
      throw new Error("expected exported job description records");
    }
    expect(exportBody.records.map((record) => record.id)).toEqual(["manual_inactive_job"]);
  });

  it("GET /export returns every job matching the filters without pagination", async () => {
    await db.insert(jobDescription).values([
      {
        allowCrossDepartmentInterviewers: true,
        createdAt: NOW,
        createdBy: USER_ID,
        departmentId: DEPARTMENT_ID,
        id: "index_hooks_export_frontend",
        name: "前端工程师",
        organizationId: ORG_ID,
        prompt: "负责前端开发。",
        recruitmentStatus: "招聘中",
        resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
        resumeScreeningPolicyVersion: 1,
        updatedAt: NOW,
      },
      {
        allowCrossDepartmentInterviewers: true,
        createdAt: NOW,
        createdBy: USER_ID,
        departmentId: DEPARTMENT_ID,
        id: "index_hooks_export_backend",
        name: "后端工程师",
        organizationId: ORG_ID,
        prompt: "负责后端开发。",
        recruitmentStatus: "招聘中",
        resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
        resumeScreeningPolicyVersion: 1,
        updatedAt: NOW,
      },
      {
        allowCrossDepartmentInterviewers: true,
        createdAt: NOW,
        createdBy: USER_ID,
        departmentId: DEPARTMENT_ID,
        id: "index_hooks_export_closed",
        name: "测试岗位",
        organizationId: ORG_ID,
        prompt: "负责测试。",
        recruitmentStatus: "已关闭",
        resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
        resumeScreeningPolicyVersion: 1,
        updatedAt: NOW,
      },
    ]);

    const response = await client["job-descriptions"].export.$get({
      query: {
        recruitmentStatus: "招聘中",
        sortBy: "name",
        sortOrder: "asc",
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    if (!("records" in body)) {
      throw new Error("expected exported job description records");
    }
    expect(body.records.map((record) => record.name)).toHaveLength(2);
    expect(body.records.map((record) => record.name)).toEqual(
      expect.arrayContaining(["后端工程师", "前端工程师"]),
    );
  });

  it("POST / enqueues a JD index job with the new record id and active org", async () => {
    const res = await client["job-descriptions"].$post({ json: jobDescriptionPayload() });
    expect(res.status).toBe(201);
    const body = await res.json();
    if (!("id" in body)) {
      throw new Error("expected the created job description record in the response body");
    }

    expect(mocks.enqueueJobDescriptionIndexJobBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueJobDescriptionIndexJobBestEffort).toHaveBeenCalledWith({
      jobDescriptionId: body.id,
      organizationId: ORG_ID,
    });
  });

  it("PATCH /:id enqueues a JD index job with the updated record id and active org", async () => {
    await db.insert(jobDescription).values({
      allowCrossDepartmentInterviewers: true,
      createdAt: NOW,
      createdBy: USER_ID,
      departmentId: DEPARTMENT_ID,
      id: EXISTING_JD_ID,
      name: "后端工程师",
      organizationId: ORG_ID,
      prompt: "负责后端服务开发。",
      resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
      resumeScreeningPolicyVersion: 1,
      updatedAt: NOW,
    });

    const res = await client["job-descriptions"][":id"].$patch({
      json: jobDescriptionPayload({ manuallyInactive: true, name: "后端工程师（已更新）" }),
      param: { id: EXISTING_JD_ID },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ manuallyInactive: true });
    const options = await client["job-descriptions"].all.$get({ query: {} });
    const optionsBody = await options.json();
    if (!("records" in optionsBody)) {
      throw new Error("expected job description choices");
    }
    expect(optionsBody.records).toEqual([]);

    const restored = await client["job-descriptions"][":id"].$patch({
      json: jobDescriptionPayload({ manuallyInactive: false, name: "后端工程师（已更新）" }),
      param: { id: EXISTING_JD_ID },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ manuallyInactive: false });
    const restoredChoices = await client["job-descriptions"].all.$get({ query: {} });
    const restoredBody = await restoredChoices.json();
    if (!("records" in restoredBody)) {
      throw new Error("expected restored job description choices");
    }
    expect(restoredBody.records.map((record) => record.id)).toEqual([EXISTING_JD_ID]);

    expect(mocks.enqueueJobDescriptionIndexJobBestEffort).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueJobDescriptionIndexJobBestEffort).toHaveBeenCalledWith({
      jobDescriptionId: EXISTING_JD_ID,
      organizationId: ORG_ID,
    });
  });

  it("changes validity without replacing other fields and rejects Google-deleted jobs", async () => {
    await db.insert(jobDescription).values({
      createdAt: NOW,
      departmentId: DEPARTMENT_ID,
      id: EXISTING_JD_ID,
      name: "保留原岗位名称",
      organizationId: ORG_ID,
      prompt: "保留原岗位要求",
      updatedAt: NOW,
    });

    const inactive = await client["job-descriptions"][":id"].validity.$patch({
      json: { manuallyInactive: true },
      param: { id: EXISTING_JD_ID },
    });
    expect(inactive.status).toBe(200);
    expect(await inactive.json()).toEqual({ manuallyInactive: true });
    const [updated] = await db
      .select({ manuallyInactive: jobDescription.manuallyInactive, name: jobDescription.name })
      .from(jobDescription)
      .where(eq(jobDescription.id, EXISTING_JD_ID));
    expect(updated).toEqual({ manuallyInactive: true, name: "保留原岗位名称" });
    expect(mocks.enqueueJobDescriptionIndexJobBestEffort).toHaveBeenCalledTimes(1);

    await db
      .update(jobDescription)
      .set({ googleSheetDeleted: true })
      .where(eq(jobDescription.id, EXISTING_JD_ID));
    const blocked = await client["job-descriptions"][":id"].validity.$patch({
      json: { manuallyInactive: false },
      param: { id: EXISTING_JD_ID },
    });
    expect(blocked.status).toBe(409);
    expect(mocks.enqueueJobDescriptionIndexJobBestEffort).toHaveBeenCalledTimes(1);
  });

  it("keeps Google-deleted jobs in management while excluding them from job choices", async () => {
    await db.insert(jobDescription).values({
      createdAt: NOW,
      departmentId: DEPARTMENT_ID,
      googleSheetDeleted: true,
      id: EXISTING_JD_ID,
      name: "表格中已删除的岗位",
      organizationId: ORG_ID,
      prompt: "岗位要求",
      updatedAt: NOW,
    });

    const choices = await client["job-descriptions"].all.$get({ query: {} });
    const choicesBody = await choices.json();
    if (!("records" in choicesBody)) {
      throw new Error("expected job description choices");
    }
    expect(choicesBody.records).toEqual([]);
    const historical = await client["job-descriptions"].all.$get({
      query: { includeInactive: "true" },
    });
    const historicalBody = await historical.json();
    if (!("records" in historicalBody)) {
      throw new Error("expected historical job description records");
    }
    expect(historicalBody.records.map((record) => record.id)).toEqual([EXISTING_JD_ID]);
    const management = await client["job-descriptions"].$get({ query: {} });
    const managementBody = await management.json();
    if (!("records" in managementBody)) {
      throw new Error("expected job description management records");
    }
    expect(managementBody.records).toMatchObject([{ id: EXISTING_JD_ID }]);
  });

  it("DELETE /:id purges the JD semantic index", async () => {
    await db.insert(jobDescription).values({
      allowCrossDepartmentInterviewers: true,
      createdAt: NOW,
      createdBy: USER_ID,
      departmentId: DEPARTMENT_ID,
      id: EXISTING_JD_ID,
      name: "测试工程师",
      organizationId: ORG_ID,
      prompt: "负责质量保障。",
      resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
      resumeScreeningPolicyVersion: 1,
      updatedAt: NOW,
    });

    const res = await client["job-descriptions"][":id"].$delete({ param: { id: EXISTING_JD_ID } });
    expect(res.status).toBe(200);

    expect(mocks.deleteJobDescriptionSemanticIndexBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.deleteJobDescriptionSemanticIndexBestEffort).toHaveBeenCalledWith({
      jobDescriptionId: EXISTING_JD_ID,
      organizationId: ORG_ID,
    });
  });
});
