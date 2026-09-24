import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { isJobDescriptionInactive } from "@arc/shared/job-descriptions";
import type { DataExportColumn } from "@/components/features/studio/data-export/data-export-model";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const salaryAmountFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormatter.format(date);
}

function formatSalary(record: JobDescriptionListRecord): string {
  if (
    record.salaryCurrency !== null &&
    record.salaryMinAmount !== null &&
    record.salaryMaxAmount !== null
  ) {
    return `${record.salaryCurrency} ${salaryAmountFormatter.format(record.salaryMinAmount)} - ${salaryAmountFormatter.format(record.salaryMaxAmount)}`;
  }
  return record.salaryRangeRaw?.trim() ?? "";
}

function formatGoogleSheetStatus(value: boolean | null): string {
  if (value === true) {
    return "已删除";
  }
  if (value === false) {
    return "未删除";
  }
  return "未关联";
}

export const jobDescriptionExportColumns: readonly DataExportColumn<JobDescriptionListRecord>[] = [
  { id: "name", label: "岗位名称", value: (row) => row.name, width: 24 },
  { id: "code", label: "岗位唯一编码", value: (row) => row.code, width: 20 },
  { id: "hiringUnitName", label: "编制组织", value: (row) => row.hiringUnitName, width: 20 },
  { id: "departmentName", label: "部门", value: (row) => row.departmentName, width: 18 },
  { id: "recruitmentStatus", label: "招聘状态", value: (row) => row.recruitmentStatus },
  {
    id: "inactive",
    label: "是否失效",
    value: (row) => (isJobDescriptionInactive(row) ? "是" : "否"),
  },
  { id: "controlCategory", label: "岗位管控分类", value: (row) => row.controlCategory },
  { id: "jobSeries", label: "序列", value: (row) => row.jobSeries },
  { id: "jobLevel", label: "职级", value: (row) => row.jobLevel },
  { id: "serviceUnit", label: "服务单位", value: (row) => row.serviceUnit },
  { id: "headcount", label: "HC", value: (row) => row.headcount },
  { id: "onboardedCount", label: "已到岗", value: (row) => row.onboardedCount },
  { id: "gapCount", label: "缺口", value: (row) => row.gapCount },
  {
    id: "offeredPendingOnboardCount",
    label: "已发 Offer 待入职",
    value: (row) => row.offeredPendingOnboardCount,
  },
  { id: "requestedDate", label: "提需日期", value: (row) => row.requestedDate },
  {
    id: "expectedOnboardDate",
    label: "期望到岗日期",
    value: (row) => row.expectedOnboardDate,
  },
  { id: "priority", label: "优先级", value: (row) => row.priority },
  { id: "requester", label: "需求发起人", value: (row) => row.requester, width: 20 },
  { id: "resumeContact", label: "简历对接人", value: (row) => row.resumeContact, width: 24 },
  { id: "prompt", label: "JD（岗位职责+任职要求）", value: (row) => row.prompt, width: 60 },
  { id: "salary", label: "薪资范围", value: formatSalary, width: 20 },
  { id: "notes", label: "备注说明", value: (row) => row.notes, width: 40 },
  { id: "workLocation", label: "工作地点", value: (row) => row.workLocation },
  { id: "workStartTime", label: "工作开始时间", value: (row) => row.workStartTime },
  { id: "workEndTime", label: "工作结束时间", value: (row) => row.workEndTime },
  { id: "workTimezone", label: "工作时区", value: (row) => row.workTimezone },
  {
    id: "creationSource",
    label: "创建来源",
    value: (row) => (row.creationSource === "google_sheets" ? "Google 表格" : "手动创建"),
  },
  { id: "sourceSheet", label: "来源表格", value: (row) => row.sourceSheet },
  {
    id: "googleSheetDeleted",
    label: "Google 文档状态",
    value: (row) => formatGoogleSheetStatus(row.googleSheetDeleted),
  },
  {
    id: "interviewers",
    label: "AI 面试官",
    value: (row) => row.interviewers.map((item) => item.name).join("、"),
    width: 24,
  },
  { id: "resumeCount", label: "关联简历数", value: (row) => row.resumeCount },
  { id: "description", label: "描述", value: (row) => row.description, width: 40 },
  { id: "createdAt", label: "创建时间", value: (row) => formatDateTime(row.createdAt), width: 20 },
  { id: "updatedAt", label: "更新时间", value: (row) => formatDateTime(row.updatedAt), width: 20 },
];

export const jobDescriptionDefaultExportColumnIds = jobDescriptionExportColumns.map(
  (column) => column.id,
);
