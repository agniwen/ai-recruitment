import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOfferCreationContext } from "./offer-creation-context";

const mocks = vi.hoisted(() => ({
  canReadInterview: true,
  canReadJob: true,
  canReadResume: true,
  database: null as unknown,
  rounds: vi.fn(),
  visible: true,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  get db() {
    return mocks.database;
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  buildResumeVisibilityCondition: () => (mocks.visible ? undefined : sql`false`),
  resolveResumeVisibilityScope: vi.fn(() => Promise.resolve({ recruiting: { kind: "all" } })),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer:
    () =>
    ({ resource }: { resource: string }) => {
      if (resource === "humanInterview") {
        return Promise.resolve(mocks.canReadInterview);
      }
      if (resource === "jd") {
        return Promise.resolve(mocks.canReadJob);
      }
      return Promise.resolve(mocks.canReadResume);
    },
}));
vi.mock("./human-interview-rounds", () => ({ listHumanInterviewRounds: mocks.rounds }));

const client = new PGlite();
const input = {
  actorRole: "odc",
  actorUserId: "odc-member",
  interviewRecordId: "candidate-a",
  organizationId: "org-a",
};
beforeAll(async () => {
  mocks.database = drizzle({ client });
  await client.exec(`
    CREATE TABLE studio_interview (id text, organization_id text, candidate_name text, resume_profile jsonb, resume_file_name text, resume_storage_key text, job_description_id text);
    CREATE TABLE job_description (id text, organization_id text, department_id text, hiring_unit_id text, creation_source text, service_unit text, job_level text, work_location text);
    CREATE TABLE department (id text, organization_id text, hiring_unit_id text, name text);
    CREATE TABLE hiring_unit (id text, organization_id text, name text);
  `);
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  mocks.canReadInterview = true;
  mocks.canReadResume = true;
  mocks.canReadJob = true;
  mocks.visible = true;
  mocks.rounds.mockReset();
  mocks.rounds.mockResolvedValue([
    {
      externalInterviewers: [{ id: "external-a", name: "外部面试官", telegram: "private-handle" }],
      feedback: "达到岗位要求",
      id: "round-a",
      interviewers: [{ id: "internal-a", name: "内部面试官" }],
      label: "技术复面",
    },
  ]);
  await client.exec(`
    TRUNCATE studio_interview, job_description, department, hiring_unit;
    INSERT INTO studio_interview VALUES ('candidate-a', 'org-a', '正确姓名', '{"name":"简历旧姓名","gender":"女"}', 'resume.pdf', 'private/resume', 'job-a');
    INSERT INTO hiring_unit VALUES ('job-unit', 'org-a', '岗位编制组织'), ('department-unit', 'org-a', '部门所属组织');
    INSERT INTO department VALUES ('department-a', 'org-a', 'department-unit', '研发部');
    INSERT INTO job_description VALUES ('job-a', 'org-a', 'department-a', 'job-unit', 'manual', '服务单位', 'P6', '上海');
  `);
});

describe("read-only Offer creation context", () => {
  it("loads canonical candidate and job defaults plus explicit interview options without changing records", async () => {
    const before = await client.query("SELECT * FROM studio_interview");
    const context = await loadOfferCreationContext(input);
    expect(context).toEqual({
      defaults: {
        candidateCode: null,
        candidateName: "正确姓名",
        departmentName: "研发部",
        directManager: null,
        gender: "女",
        hiringUnitName: "岗位编制组织",
        interviewFeedback: null,
        interviewRoundId: null,
        jobLevel: "P6",
        jobType: null,
        mainInterviewerName: null,
        managementSequence: null,
        personnelType: null,
        probationPeriod: null,
        probationSalary: null,
        serviceUnit: "服务单位",
        workLocation: "上海",
        workMode: null,
      },
      interviewRounds: [
        {
          feedback: "达到岗位要求",
          id: "round-a",
          interviewers: [
            { id: "internal-a", name: "内部面试官" },
            { id: "external-a", name: "外部面试官" },
          ],
          label: "技术复面",
        },
      ],
      resume: { available: true, filename: "resume.pdf", mediaType: "application/pdf" },
    });
    expect(await client.query("SELECT * FROM studio_interview")).toEqual(before);
  });

  it("uses the department organization only as a manual-job fallback", async () => {
    await client.exec("UPDATE job_description SET hiring_unit_id = NULL");
    const manualContext = await loadOfferCreationContext(input);
    expect(manualContext?.defaults.hiringUnitName).toBe("部门所属组织");
    await client.exec("UPDATE job_description SET creation_source = 'google_sheets'");
    const googleContext = await loadOfferCreationContext(input);
    expect(googleContext?.defaults.hiringUnitName).toBeNull();
  });

  it("does not reveal the candidate across workspaces", async () => {
    expect(await loadOfferCreationContext({ ...input, organizationId: "org-b" })).toBeNull();
    expect(mocks.rounds).not.toHaveBeenCalled();
  });

  it("applies candidate visibility even within the active workspace", async () => {
    mocks.visible = false;
    expect(await loadOfferCreationContext(input)).toBeNull();
  });

  it("withholds interview feedback and file access without their read permissions", async () => {
    mocks.canReadInterview = false;
    mocks.canReadResume = false;
    const context = await loadOfferCreationContext(input);
    expect(context?.interviewRounds).toEqual([]);
    expect(context?.defaults.interviewFeedback).toBeNull();
    expect(context?.resume.available).toBe(false);
    expect(mocks.rounds).not.toHaveBeenCalled();
  });

  it("leaves job defaults empty without jd.read while retaining candidate defaults for manual completion", async () => {
    mocks.canReadJob = false;
    const context = await loadOfferCreationContext(input);
    expect(context?.defaults).toMatchObject({
      candidateName: "正确姓名",
      departmentName: null,
      gender: "女",
      hiringUnitName: null,
      jobLevel: null,
      serviceUnit: null,
      workLocation: null,
    });
    expect(context?.interviewRounds).toHaveLength(1);
    expect(context?.resume.available).toBe(true);
  });
});
