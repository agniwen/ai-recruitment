import { bindResumePoolItemJobDescription } from "../routes/resume-pool/dao/bind-job-description";
import { resolveHiringUnitAccessScope } from "../utils/hiring-unit-scope";
import {
  buildResumeVisibilityCondition,
  resolveResumeVisibilityScope,
} from "../../../access/resume-visibility";
import { resolveJobDescriptionResumeSource } from "../routes/job-descriptions/resume-source";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  resumePoolItem,
  studioInterview,
  department,
  departmentOdcMember,
  hiringUnit,
  hiringUnitOdcMember,
  resumeSource,
  resumeSourceOdcMember,
  interviewer,
  jobDescription,
  member,
  organization,
  organizationRole,
  recruitingGroup,
  recruitingGroupResumeSource,
  recruitingGroupHiringUnit,
  recruitingGroupMember,
  user,
} from "@arc/db-schema/schema";
import { listAllDepartments } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { listAllInterviewers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviewers/dao";
import { listAllJobDescriptions } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";

const ORG = "hiring_scope_org";
const OWNER = "hiring_scope_owner";
const MEMBER = "hiring_scope_member";
const NO_GROUP_MEMBER = "hiring_scope_no_group_member";
const NO_GROUP_MEMBER_ID = "hiring_scope_no_group_member_member";
const GROUP_A = "hiring_scope_group_a";
const HIRING_UNIT_A = "hiring_scope_unit_a";
const HIRING_UNIT_B = "hiring_scope_unit_b";
const DEPT_PUBLIC = "hiring_scope_dept_public";
const DEPT_A = "hiring_scope_dept_a";
const DEPT_B = "hiring_scope_dept_b";
const INTERVIEWER_PUBLIC = "hiring_scope_interviewer_public";
const INTERVIEWER_A = "hiring_scope_interviewer_a";
const INTERVIEWER_B = "hiring_scope_interviewer_b";
const JD_PUBLIC = "hiring_scope_jd_public";
const JD_A = "hiring_scope_jd_a";
const JD_B = "hiring_scope_jd_b";

const NOW = new Date("2026-06-22T10:00:00.000Z");

function ids<T extends { id: string }>(rows: T[]) {
  return rows.map((row) => row.id).toSorted();
}

async function clean() {
  await db.delete(resumePoolItem).where(eq(resumePoolItem.organizationId, ORG));
  await db.delete(studioInterview).where(eq(studioInterview.organizationId, ORG));
  await db.delete(jobDescription).where(eq(jobDescription.organizationId, ORG));
  await db.delete(interviewer).where(eq(interviewer.organizationId, ORG));
  await db.delete(department).where(eq(department.organizationId, ORG));
  await db
    .delete(recruitingGroupResumeSource)
    .where(eq(recruitingGroupResumeSource.organizationId, ORG));
  await db
    .delete(recruitingGroupHiringUnit)
    .where(eq(recruitingGroupHiringUnit.organizationId, ORG));
  await db.delete(hiringUnit).where(eq(hiringUnit.organizationId, ORG));
  await db.delete(resumeSourceOdcMember).where(eq(resumeSourceOdcMember.organizationId, ORG));
  await db.delete(resumeSource).where(eq(resumeSource.organizationId, ORG));
  await db.delete(organizationRole).where(eq(organizationRole.organizationId, ORG));
  await db.delete(recruitingGroupMember).where(eq(recruitingGroupMember.organizationId, ORG));
  await db.delete(recruitingGroup).where(eq(recruitingGroup.organizationId, ORG));
  await db.delete(member).where(eq(member.organizationId, ORG));
  await db.delete(organization).where(eq(organization.id, ORG));
  await db.delete(organization).where(eq(organization.id, "another_workspace"));
  await db.delete(user).where(eq(user.id, OWNER));
  await db.delete(user).where(eq(user.id, MEMBER));
  await db.delete(user).where(eq(user.id, NO_GROUP_MEMBER));
}

async function seedWorkspace() {
  await db.insert(user).values([
    {
      createdAt: NOW,
      email: "hiring-scope-owner@example.com",
      emailVerified: true,
      id: OWNER,
      name: "Hiring Scope Owner",
      updatedAt: NOW,
    },
    {
      createdAt: NOW,
      email: "hiring-scope-member@example.com",
      emailVerified: true,
      id: MEMBER,
      name: "Hiring Scope Member",
      updatedAt: NOW,
    },
    {
      createdAt: NOW,
      email: "hiring-scope-no-group@example.com",
      emailVerified: true,
      id: NO_GROUP_MEMBER,
      name: "Hiring Scope No Group",
      updatedAt: NOW,
    },
  ]);
  await db.insert(organization).values({
    createdAt: NOW,
    id: ORG,
    name: "Hiring Scope Org",
    slug: "hiring-scope-org",
  });
  await db.insert(organizationRole).values({
    createdAt: NOW,
    id: "hiring_scope_odc_role",
    isOdc: true,
    name: "ODC",
    organizationId: ORG,
    permission: "member",
    role: "odc",
    updatedAt: NOW,
  });
  await db.insert(member).values([
    {
      createdAt: NOW,
      id: "hiring_scope_owner_member",
      organizationId: ORG,
      role: "owner",
      userId: OWNER,
    },
    {
      createdAt: NOW,
      id: "hiring_scope_member_member",
      organizationId: ORG,
      role: "member",
      userId: MEMBER,
    },
    {
      createdAt: NOW,
      id: NO_GROUP_MEMBER_ID,
      organizationId: ORG,
      role: "odc",
      userId: NO_GROUP_MEMBER,
    },
  ]);
  await db
    .insert(resumeSource)
    .values({ id: "group_source_a", name: "招聘来源 A", organizationId: ORG });
  await db.insert(hiringUnit).values([
    {
      createdAt: NOW,
      createdBy: OWNER,
      id: HIRING_UNIT_A,
      name: "A 用人组织",
      organizationId: ORG,
      resumeSourceId: "group_source_a",
      updatedAt: NOW,
    },
    {
      createdAt: NOW,
      createdBy: OWNER,
      id: HIRING_UNIT_B,
      name: "B 用人组织",
      organizationId: ORG,
      updatedAt: NOW,
    },
  ]);
  await db.insert(recruitingGroup).values({
    createdAt: NOW,
    createdBy: OWNER,
    id: GROUP_A,
    name: "A 招聘组",
    organizationId: ORG,
    updatedAt: NOW,
  });
  await db.insert(recruitingGroupMember).values({
    createdAt: NOW,
    createdBy: OWNER,
    groupId: GROUP_A,
    id: "hiring_scope_group_member",
    organizationId: ORG,
    role: "hr",
    updatedAt: NOW,
    userId: MEMBER,
  });
  await db.insert(recruitingGroupResumeSource).values({
    createdAt: NOW,
    createdBy: OWNER,
    groupId: GROUP_A,
    id: "hiring_scope_group_unit_a",
    organizationId: ORG,
    resumeSourceId: "group_source_a",
  });
  await db.insert(department).values([
    {
      createdAt: NOW,
      createdBy: OWNER,
      hiringUnitId: null,
      id: DEPT_PUBLIC,
      name: "公共部门",
      organizationId: ORG,
      updatedAt: NOW,
    },
    {
      createdAt: NOW,
      createdBy: OWNER,
      hiringUnitId: HIRING_UNIT_A,
      id: DEPT_A,
      name: "A 部门",
      organizationId: ORG,
      updatedAt: NOW,
    },
    {
      createdAt: NOW,
      createdBy: OWNER,
      hiringUnitId: HIRING_UNIT_B,
      id: DEPT_B,
      name: "B 部门",
      organizationId: ORG,
      updatedAt: NOW,
    },
  ]);
  await db.insert(interviewer).values([
    {
      createdAt: NOW,
      createdBy: OWNER,
      departmentId: DEPT_PUBLIC,
      id: INTERVIEWER_PUBLIC,
      name: "公共面试官",
      organizationId: ORG,
      prompt: "公共面试官 prompt",
      updatedAt: NOW,
      voice: "male-qn-qingse",
    },
    {
      createdAt: NOW,
      createdBy: OWNER,
      departmentId: DEPT_A,
      id: INTERVIEWER_A,
      name: "A 面试官",
      organizationId: ORG,
      prompt: "A 面试官 prompt",
      updatedAt: NOW,
      voice: "male-qn-qingse",
    },
    {
      createdAt: NOW,
      createdBy: OWNER,
      departmentId: DEPT_B,
      id: INTERVIEWER_B,
      name: "B 面试官",
      organizationId: ORG,
      prompt: "B 面试官 prompt",
      updatedAt: NOW,
      voice: "male-qn-qingse",
    },
  ]);
  await db.insert(jobDescription).values([
    {
      allowCrossDepartmentInterviewers: false,
      createdAt: NOW,
      createdBy: OWNER,
      departmentId: DEPT_PUBLIC,
      id: JD_PUBLIC,
      name: "公共岗位",
      organizationId: ORG,
      prompt: "公共岗位 prompt",
      updatedAt: NOW,
    },
    {
      allowCrossDepartmentInterviewers: false,
      createdAt: NOW,
      createdBy: OWNER,
      departmentId: DEPT_A,
      id: JD_A,
      name: "A 岗位",
      organizationId: ORG,
      prompt: "A 岗位 prompt",
      resumeSourceId: "group_source_a",
      updatedAt: NOW,
    },
    {
      allowCrossDepartmentInterviewers: false,
      createdAt: NOW,
      createdBy: OWNER,
      departmentId: DEPT_B,
      id: JD_B,
      name: "B 岗位",
      organizationId: ORG,
      prompt: "B 岗位 prompt",
      updatedAt: NOW,
    },
  ]);
}

describe("hiring unit recruiting-group scope", () => {
  beforeEach(async () => {
    await clean();
    await seedWorkspace();
  }, 30_000);

  afterEach(clean, 30_000);

  it("普通招聘组成员只能看到公共部门和其招聘组负责部门/中心（来源）下的数据", async () => {
    const [departments, interviewers, jobDescriptions] = await Promise.all([
      listAllDepartments(ORG, { actorUserId: MEMBER }),
      listAllInterviewers(ORG, { actorUserId: MEMBER }),
      listAllJobDescriptions(ORG, { actorUserId: MEMBER }),
    ]);

    expect(ids(departments)).toEqual([DEPT_A, DEPT_PUBLIC].toSorted());
    expect(ids(interviewers)).toEqual([INTERVIEWER_A, INTERVIEWER_PUBLIC].toSorted());
    expect(ids(jobDescriptions)).toEqual([JD_A, JD_PUBLIC].toSorted());
  });

  it("来源内新增同名组织自动授权，移到其他来源立即撤销，旧配置不授权", async () => {
    await db
      .insert(resumeSource)
      .values({ id: "other_source", name: "其他来源", organizationId: ORG });
    await db.insert(hiringUnit).values([
      {
        id: "new_source_unit",
        name: "A 用人组织",
        organizationId: ORG,
        resumeSourceId: "group_source_a",
      },
      {
        id: "other_source_unit",
        name: "A 用人组织",
        organizationId: ORG,
        resumeSourceId: "other_source",
      },
    ]);
    await db.insert(department).values([
      {
        hiringUnitId: "new_source_unit",
        id: "new_source_dept",
        name: "A 部门",
        organizationId: ORG,
      },
      {
        hiringUnitId: "other_source_unit",
        id: "other_source_dept",
        name: "A 部门",
        organizationId: ORG,
      },
    ]);
    await db.insert(recruitingGroupHiringUnit).values({
      groupId: GROUP_A,
      hiringUnitId: "other_source_unit",
      id: "legacy_grant",
      organizationId: ORG,
    });
    expect(ids(await listAllDepartments(ORG, { actorUserId: MEMBER }))).toEqual(
      [DEPT_A, DEPT_PUBLIC, "new_source_dept"].toSorted(),
    );
    await db
      .update(hiringUnit)
      .set({ resumeSourceId: "other_source" })
      .where(eq(hiringUnit.id, "new_source_unit"));
    expect(ids(await listAllDepartments(ORG, { actorUserId: MEMBER }))).toEqual(
      [DEPT_A, DEPT_PUBLIC].toSorted(),
    );
  });

  it("岗位来源切换立即改变招聘组可见性，不依赖旧部门或用人组织", async () => {
    await db
      .insert(resumeSource)
      .values({ id: "source_without_units", name: "独立来源", organizationId: ORG });
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "source_without_units" })
      .where(eq(jobDescription.id, JD_A));
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: MEMBER }))).toEqual([JD_PUBLIC]);
    await db
      .update(recruitingGroupResumeSource)
      .set({ resumeSourceId: "source_without_units" })
      .where(eq(recruitingGroupResumeSource.groupId, GROUP_A));
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: MEMBER }))).toEqual(
      [JD_A, JD_PUBLIC].toSorted(),
    );
  });

  it("owner 不受招聘组部门/中心（来源）范围限制", async () => {
    const [departments, interviewers, jobDescriptions] = await Promise.all([
      listAllDepartments(ORG, { actorUserId: OWNER }),
      listAllInterviewers(ORG, { actorUserId: OWNER }),
      listAllJobDescriptions(ORG, { actorUserId: OWNER }),
    ]);

    expect(ids(departments)).toEqual([DEPT_A, DEPT_B, DEPT_PUBLIC].toSorted());
    expect(ids(interviewers)).toEqual(
      [INTERVIEWER_A, INTERVIEWER_B, INTERVIEWER_PUBLIC].toSorted(),
    );
    expect(ids(jobDescriptions)).toEqual([JD_A, JD_B, JD_PUBLIC].toSorted());
  });

  it("未加入招聘组的普通成员看不到公共部门或私有部门数据", async () => {
    const [departments, interviewers, jobDescriptions] = await Promise.all([
      listAllDepartments(ORG, { actorUserId: NO_GROUP_MEMBER }),
      listAllInterviewers(ORG, { actorUserId: NO_GROUP_MEMBER }),
      listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }),
    ]);

    expect(departments).toEqual([]);
    expect(interviewers).toEqual([]);
    expect(jobDescriptions).toEqual([]);
  });

  it("移除招聘组负责部门/中心（来源）后，普通成员只保留公共范围", async () => {
    await db
      .delete(recruitingGroupResumeSource)
      .where(
        and(
          eq(recruitingGroupResumeSource.organizationId, ORG),
          eq(recruitingGroupResumeSource.groupId, GROUP_A),
        ),
      );

    const [departments, interviewers, jobDescriptions] = await Promise.all([
      listAllDepartments(ORG, { actorUserId: MEMBER }),
      listAllInterviewers(ORG, { actorUserId: MEMBER }),
      listAllJobDescriptions(ORG, { actorUserId: MEMBER }),
    ]);

    expect(ids(departments)).toEqual([DEPT_PUBLIC]);
    expect(ids(interviewers)).toEqual([INTERVIEWER_PUBLIC]);
    expect(ids(jobDescriptions)).toEqual([JD_PUBLIC]);
  });

  it("旧部门和用人组织 ODC 不再授权，部门/中心（来源）覆盖下属组织", async () => {
    await db
      .insert(departmentOdcMember)
      .values({ departmentId: DEPT_B, memberId: NO_GROUP_MEMBER_ID, organizationId: ORG });
    await db
      .insert(hiringUnitOdcMember)
      .values({ hiringUnitId: HIRING_UNIT_A, memberId: NO_GROUP_MEMBER_ID, organizationId: ORG });
    expect(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER })).toEqual([]);
    await db
      .insert(resumeSource)
      .values({ id: "hiring_scope_source", name: "来源", organizationId: ORG });
    await db
      .update(hiringUnit)
      .set({ resumeSourceId: "hiring_scope_source" })
      .where(eq(hiringUnit.id, HIRING_UNIT_A));
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "hiring_scope_source" })
      .where(eq(jobDescription.id, JD_A));
    await db.insert(resumeSourceOdcMember).values({
      memberId: NO_GROUP_MEMBER_ID,
      organizationId: ORG,
      resumeSourceId: "hiring_scope_source",
    });
    expect(ids(await listAllDepartments(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual([DEPT_A]);
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual([
      JD_A,
    ]);
    await db
      .update(hiringUnit)
      .set({ resumeSourceId: "hiring_scope_source" })
      .where(eq(hiringUnit.id, HIRING_UNIT_B));
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual([
      JD_A,
    ]);
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "hiring_scope_source" })
      .where(eq(jobDescription.id, JD_B));
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual(
      [JD_A, JD_B].toSorted(),
    );
    await db
      .update(hiringUnit)
      .set({ resumeSourceId: null })
      .where(eq(hiringUnit.id, HIRING_UNIT_A));
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual(
      [JD_A, JD_B].toSorted(),
    );
    await db
      .update(jobDescription)
      .set({ resumeSourceId: null })
      .where(eq(jobDescription.id, JD_A));
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual([
      JD_B,
    ]);
  });

  it("ODC 按岗位来源及序列、服务单位读取简历，来源切换和撤销挂靠即时生效", async () => {
    await db
      .insert(resumeSource)
      .values({ id: "odc_standalone_source", name: "无下属组织的来源", organizationId: ORG });
    await db
      .update(jobDescription)
      .set({ jobSeries: "派驻", resumeSourceId: "odc_standalone_source", serviceUnit: "服务A" })
      .where(eq(jobDescription.id, JD_A));
    await db
      .update(jobDescription)
      .set({ jobSeries: "直属", resumeSourceId: "odc_standalone_source", serviceUnit: "服务A" })
      .where(eq(jobDescription.id, JD_B));
    await db.insert(resumeSourceOdcMember).values({
      jobSeries: "派驻",
      memberId: NO_GROUP_MEMBER_ID,
      organizationId: ORG,
      resumeSourceId: "odc_standalone_source",
      serviceUnit: "服务A",
    });
    await db.insert(studioInterview).values([
      {
        candidateName: "候选人A",
        createdBy: OWNER,
        id: "source_candidate_a",
        jobDescriptionId: JD_A,
        organizationId: ORG,
      },
      {
        candidateName: "候选人B",
        createdBy: OWNER,
        id: "source_candidate_b",
        jobDescriptionId: JD_B,
        organizationId: ORG,
      },
    ]);
    const scope = await resolveResumeVisibilityScope({
      currentRole: "odc",
      organizationId: ORG,
      userId: NO_GROUP_MEMBER,
    });
    const visible = () =>
      db
        .select({ id: studioInterview.id })
        .from(studioInterview)
        .where(and(eq(studioInterview.organizationId, ORG), buildResumeVisibilityCondition(scope)));
    expect(ids(await visible())).toEqual(["source_candidate_a"]);
    await db
      .update(jobDescription)
      .set({ serviceUnit: "服务B" })
      .where(eq(jobDescription.id, JD_A));
    expect(await visible()).toEqual([]);
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "group_source_a", serviceUnit: "服务A" })
      .where(eq(jobDescription.id, JD_A));
    expect(await visible()).toEqual([]);
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "odc_standalone_source" })
      .where(eq(jobDescription.id, JD_A));
    expect(ids(await visible())).toEqual(["source_candidate_a"]);
    await db.delete(resumeSourceOdcMember).where(eq(resumeSourceOdcMember.organizationId, ORG));
    expect(await visible()).toEqual([]);
  });

  it("来源保存按 ID 校验范围，并拒绝其他工作区的来源", async () => {
    expect(
      await resolveJobDescriptionResumeSource({
        actorUserId: MEMBER,
        organizationId: ORG,
        resumeSourceId: "group_source_a",
        sourceSheet: "过期名称",
      }),
    ).toMatchObject({ error: null, resumeSourceId: "group_source_a", sourceSheet: "招聘来源 A" });
    await db
      .insert(resumeSource)
      .values({ id: "unassigned_source", name: "未授权来源", organizationId: ORG });
    const denied = await resolveJobDescriptionResumeSource({
      actorUserId: MEMBER,
      organizationId: ORG,
      resumeSourceId: "unassigned_source",
    });
    expect(denied.error).toBeTruthy();
    const foreign = await resolveJobDescriptionResumeSource({
      actorUserId: OWNER,
      organizationId: "another_workspace",
      resumeSourceId: "group_source_a",
    });
    expect(foreign.error).toBeTruthy();
    await db
      .insert(organization)
      .values({ id: "another_workspace", name: "Other", slug: "another-workspace" });
    await expect(
      db
        .update(jobDescription)
        .set({ organizationId: "another_workspace", resumeSourceId: "group_source_a" })
        .where(eq(jobDescription.id, JD_B)),
    ).rejects.toThrow();
  });

  it("简历池绑定岗位不能通过旧部门绕过来源范围", async () => {
    await db
      .insert(resumeSource)
      .values({ id: "pool_other_source", name: "其他来源", organizationId: ORG });
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "pool_other_source" })
      .where(eq(jobDescription.id, JD_A));
    await db.insert(resumePoolItem).values({
      candidateName: "候选人",
      createdBy: MEMBER,
      id: "source_pool_item",
      organizationId: ORG,
      scope: "private",
    });
    const scope = await resolveHiringUnitAccessScope({ actorUserId: MEMBER, organizationId: ORG });
    const bind = () =>
      bindResumePoolItemJobDescription({
        actorId: MEMBER,
        hiringUnitScope: scope,
        jobDescriptionId: JD_A,
        organizationId: ORG,
        poolItemId: "source_pool_item",
      });
    expect(await bind()).toBe("job_description_not_found");
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "group_source_a" })
      .where(eq(jobDescription.id, JD_A));
    expect(await bind()).toBe("bound");
  });

  it("角色取消 ODC 标记后立即失去已分配范围", async () => {
    await db
      .insert(resumeSource)
      .values({ id: "hiring_scope_source", name: "来源", organizationId: ORG });
    await db
      .update(hiringUnit)
      .set({ resumeSourceId: "hiring_scope_source" })
      .where(eq(hiringUnit.id, HIRING_UNIT_A));
    await db
      .update(jobDescription)
      .set({ resumeSourceId: "hiring_scope_source" })
      .where(eq(jobDescription.id, JD_A));
    await db.insert(resumeSourceOdcMember).values({
      memberId: NO_GROUP_MEMBER_ID,
      organizationId: ORG,
      resumeSourceId: "hiring_scope_source",
    });
    expect(ids(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER }))).toEqual([
      JD_A,
    ]);
    await db
      .update(organizationRole)
      .set({ isOdc: false })
      .where(and(eq(organizationRole.organizationId, ORG), eq(organizationRole.role, "odc")));

    expect(await listAllJobDescriptions(ORG, { actorUserId: NO_GROUP_MEMBER })).toEqual([]);
  });
});
