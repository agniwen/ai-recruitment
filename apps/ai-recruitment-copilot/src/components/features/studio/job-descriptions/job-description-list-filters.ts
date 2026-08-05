import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import type { ToolbarFilterConfig } from "@/components/data-grid";

export function createJobDescriptionListFilters({
  departments,
  hiringUnits,
  interviewers,
  recruitmentStatuses,
  sourceSheets,
}: {
  departments: DepartmentRecord[];
  hiringUnits: { id: string; name: string }[];
  interviewers: InterviewerListRecord[];
  recruitmentStatuses: string[];
  sourceSheets: string[];
}): ToolbarFilterConfig[] {
  return [
    {
      key: "search",
      minWidth: "15rem",
      placeholder: "搜索在招岗位名称或描述",
      type: "search",
    },
    {
      key: "code",
      minWidth: "12rem",
      placeholder: "筛选岗位唯一编码",
      type: "search",
    },
    {
      emptyMessage: "没有匹配的来源表格",
      key: "sourceSheet",
      options: sourceSheets.map((sourceSheet) => ({
        label: sourceSheet,
        value: sourceSheet,
      })),
      placeholder: "全部来源表格",
      searchPlaceholder: "搜索来源表格…",
      type: "select",
    },
    {
      emptyMessage: "没有匹配的招聘状态",
      key: "recruitmentStatus",
      options: recruitmentStatuses.map((status) => ({ label: status, value: status })),
      placeholder: "全部招聘状态",
      searchPlaceholder: "搜索招聘状态…",
      selectedFormat: (count: number) => `已选 ${count} 个状态`,
      type: "multi-select",
    },
    {
      key: "googleSheetStatus",
      options: [
        { label: "文档中存在", value: "active" },
        { label: "文档中已删除", value: "deleted" },
        { label: "未关联 Google 文档", value: "unlinked" },
      ],
      placeholder: "全部 Google 文档状态",
      type: "select",
    },
    {
      emptyMessage: "没有匹配的编制组织",
      key: "hiringUnitId",
      options: hiringUnits.map((hiringUnit) => ({
        label: hiringUnit.name,
        value: hiringUnit.id,
      })),
      placeholder: "全部编制组织",
      searchPlaceholder: "搜索编制组织…",
      selectedFormat: (count: number) => `已选 ${count} 个编制组织`,
      type: "multi-select",
    },
    {
      emptyMessage: "没有匹配的部门",
      key: "departmentId",
      options: departments.map((department) => ({
        label: department.name,
        value: department.id,
      })),
      placeholder: "全部部门",
      searchPlaceholder: "搜索部门…",
      selectedFormat: (count: number) => `已选 ${count} 个部门`,
      type: "multi-select",
    },
    {
      emptyMessage: "没有匹配的 AI面试官",
      key: "interviewerId",
      options: interviewers.map((interviewer) => ({
        description: interviewer.departmentName ?? "未知部门",
        label: interviewer.name,
        value: interviewer.id,
      })),
      placeholder: "全部 AI面试官",
      searchPlaceholder: "搜索 AI面试官…",
      selectedFormat: (count: number) => `已选 ${count} 位 AI面试官`,
      type: "multi-select",
    },
  ];
}
