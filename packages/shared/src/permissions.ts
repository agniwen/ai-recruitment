// src/lib/shared/permissions.ts
//
// 多租户权限矩阵的唯一真相源。
// 服务端 (auth.ts) 与客户端 (auth-client.ts) 共享同一份 statement + ac + roles。
// shared 位置而非 server-only：本文件无 node:* 依赖，纯类型 + 配置。
//
// Single source of truth for the multi-tenant permission matrix.
// Server (auth.ts) and client (auth-client.ts) both import the same statement,
// ac, and roles. Lives under shared/ because it has no node:* imports.

import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, memberAc } from "better-auth/plugins/organization/access";

export const STUDIO_PAGE_PERMISSION_ACTIONS = [
  "resumes",
  "resumePool",
  "aiReview",
  "interviews",
  "calendar",
  "dashboard",
  "odcAnalysis",
  "dataExport",
  "hiringUnits",
  "departments",
  "interviewers",
  "jobDescriptions",
  "forms",
  "interviewQuestions",
  "me",
  "members",
  "chat",
  "mailIngestAccounts",
  "permissions",
  "preRegistrations",
  "globalConfig",
] as const;

export const STUDIO_PAGE_PERMISSION_LABELS = {
  aiReview: "AI 分析审批",
  // page:chat still keys the former Chat browse flag; UI now gates the Agent tab.
  calendar: "面试日程",
  chat: "Agent",
  dashboard: "招聘看板",
  dataExport: "导出数据",
  departments: "部门设置",
  forms: "AI面试-面前通用题",
  globalConfig: "公司信息与话术",
  hiringUnits: "用人组织",
  interviewQuestions: "AI面试-沟通通用题",
  interviewers: "AI 面试官",
  interviews: "AI面试管理",
  jobDescriptions: "在招岗位",
  mailIngestAccounts: "简历邮箱采集",
  me: "个人中心",
  members: "成员与招聘组",
  odcAnalysis: "ODC分析",
  permissions: "角色与权限",
  preRegistrations: "预录入信息",
  resumePool: "简历池",
  resumes: "候选人管理",
} as const;

const memberStudioPagePermissions = [
  "resumes",
  "resumePool",
  "interviews",
  "calendar",
  "dataExport",
  "hiringUnits",
  "departments",
  "interviewers",
  "jobDescriptions",
  "forms",
  "interviewQuestions",
  "me",
  "members",
  "chat",
] as const;

export const statement = {
  ...defaultStatements,
  aiReview: ["read", "approve"],
  auditLog: ["read"],
  candidateClose: ["create"],
  candidateForm: ["create", "read", "update", "delete"],
  chat: ["create", "read", "update", "delete"],
  dataExport: ["export"],
  department: ["create", "read", "update", "delete"],
  // Deny flag (勾选 = 不能评估). Default for all roles is allow evaluation.
  // owner/admin hold create so Better Auth lets them assign the flag to others;
  // isResumeEvaluationDisabled() ignores this flag for owner/admin themselves.
  disableResumeEvaluation: ["create"],
  globalConfig: ["read", "update"],
  hiringUnit: ["create", "read", "update", "delete"],
  humanInterview: ["create", "read", "update", "delete"],
  interview: ["create", "read", "update", "delete"],
  interviewer: ["create", "read", "update", "delete"],
  jd: ["create", "read", "update", "delete"],
  mailIngestAccount: ["create", "read", "update", "delete", "manage"],
  offer: ["create", "read", "update", "delete"],
  page: STUDIO_PAGE_PERMISSION_ACTIONS,
  questionTemplate: ["create", "read", "update", "delete"],
  resumeLibrary: ["create", "read", "update", "delete"],
  resumePool: ["create", "read", "publish", "import", "delete", "retryFailed"],
  resumeUploadBatch: ["create", "read", "process", "cancel", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const NO_ACCESS_WORKSPACE_ROLE = "noAccess";

export function isWorkspaceAdministratorRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

// Administrators and owners receive the entire catalog, including future permissions.
// Deny flags are assignment capabilities; their consumers exempt administrators.
export const owner = ac.newRole(statement);
export const admin = ac.newRole(statement);

const recruitingMemberStatements = {
  ...memberAc.statements,
  auditLog: ["read"],
  candidateClose: ["create"],
  candidateForm: ["create", "read", "update", "delete"],
  chat: ["create", "read", "update", "delete"],
  dataExport: ["export"],
  department: ["read"],
  globalConfig: ["read", "update"],
  hiringUnit: ["read"],
  humanInterview: ["create", "read", "update", "delete"],
  interview: ["create", "read", "update", "delete"],
  interviewer: ["create", "read", "update", "delete"],
  jd: ["create", "read", "update", "delete"],
  offer: ["create", "read", "update", "delete"],
  page: memberStudioPagePermissions,
  questionTemplate: ["create", "read", "update", "delete"],
  // member can evaluate by default; does not hold disableResumeEvaluation.
  resumeLibrary: ["create", "read", "update", "delete"],
  resumePool: ["create", "read", "publish", "import", "delete"],
  resumeUploadBatch: ["create", "read", "process", "cancel", "delete"],
} as const;

export const member = ac.newRole(recruitingMemberStatements);
export const noAccess = ac.newRole({
  page: [],
});

export const roles = { admin, member, noAccess, owner } as const;
export type AppRole = keyof typeof roles;
