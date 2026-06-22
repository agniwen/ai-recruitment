import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  hiringUnit,
  interviewer,
  jobDescription,
  member,
  organization,
  recruitingGroup,
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
  await db.delete(jobDescription).where(eq(jobDescription.organizationId, ORG));
  await db.delete(interviewer).where(eq(interviewer.organizationId, ORG));
  await db.delete(department).where(eq(department.organizationId, ORG));
  await db
    .delete(recruitingGroupHiringUnit)
    .where(eq(recruitingGroupHiringUnit.organizationId, ORG));
  await db.delete(hiringUnit).where(eq(hiringUnit.organizationId, ORG));
  await db.delete(recruitingGroupMember).where(eq(recruitingGroupMember.organizationId, ORG));
  await db.delete(recruitingGroup).where(eq(recruitingGroup.organizationId, ORG));
  await db.delete(member).where(eq(member.organizationId, ORG));
  await db.delete(organization).where(eq(organization.id, ORG));
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
      id: "hiring_scope_no_group_member_member",
      organizationId: ORG,
      role: "member",
      userId: NO_GROUP_MEMBER,
    },
  ]);
  await db.insert(hiringUnit).values([
    {
      createdAt: NOW,
      createdBy: OWNER,
      id: HIRING_UNIT_A,
      name: "A 用人组织",
      organizationId: ORG,
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
  await db.insert(recruitingGroupHiringUnit).values({
    createdAt: NOW,
    createdBy: OWNER,
    groupId: GROUP_A,
    hiringUnitId: HIRING_UNIT_A,
    id: "hiring_scope_group_unit_a",
    organizationId: ORG,
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

  it("普通招聘组成员只能看到公共部门和其招聘组负责用人组织下的数据", async () => {
    const [departments, interviewers, jobDescriptions] = await Promise.all([
      listAllDepartments(ORG, { actorUserId: MEMBER }),
      listAllInterviewers(ORG, { actorUserId: MEMBER }),
      listAllJobDescriptions(ORG, { actorUserId: MEMBER }),
    ]);

    expect(ids(departments)).toEqual([DEPT_A, DEPT_PUBLIC].toSorted());
    expect(ids(interviewers)).toEqual([INTERVIEWER_A, INTERVIEWER_PUBLIC].toSorted());
    expect(ids(jobDescriptions)).toEqual([JD_A, JD_PUBLIC].toSorted());
  });

  it("owner 不受招聘组用人组织范围限制", async () => {
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

  it("移除招聘组负责用人组织后，普通成员只保留公共范围", async () => {
    await db
      .delete(recruitingGroupHiringUnit)
      .where(
        and(
          eq(recruitingGroupHiringUnit.organizationId, ORG),
          eq(recruitingGroupHiringUnit.groupId, GROUP_A),
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
});
