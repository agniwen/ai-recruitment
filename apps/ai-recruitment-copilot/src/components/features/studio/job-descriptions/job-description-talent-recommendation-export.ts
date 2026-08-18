import { resumeParseStatusMeta } from "@arc/db-schema/studio-interviews";
import type {
  JobDescriptionTalentRecommendation,
  JobDescriptionTalentRecommendationSource,
} from "@arc/shared/job-descriptions";
import { formatDate } from "@arc/shared/utils/time";
import type { DataExportColumn } from "@/components/features/studio/data-export/data-export-model";

const SOURCE_LABEL: Record<JobDescriptionTalentRecommendationSource, string> = {
  public_resume_pool: "简历池",
  resume_library: "候选人管理",
};

function displayDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const formatted = formatDate(value);
  return formatted === "—" ? "" : formatted;
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number") {
    return "";
  }
  return `${Math.round(value * 100)}%`;
}

function formatEducation(row: JobDescriptionTalentRecommendation): string {
  if (row.profileHighlights.educationLines.length > 0) {
    return row.profileHighlights.educationLines.join("；");
  }
  return row.profileHighlights.schools.join("；");
}

export const talentRecommendationExportColumns: readonly DataExportColumn<JobDescriptionTalentRecommendation>[] =
  [
    { id: "id", label: "候选人ID", value: (row) => row.id, width: 24 },
    { id: "candidateName", label: "候选人姓名", value: (row) => row.candidateName, width: 16 },
    { id: "candidateEmail", label: "邮箱", value: (row) => row.candidateEmail, width: 28 },
    { id: "candidatePhone", label: "电话", value: (row) => row.candidatePhone, width: 18 },
    { id: "source", label: "来源", value: (row) => SOURCE_LABEL[row.source] },
    { id: "targetRole", label: "目标岗位", value: (row) => row.targetRole, width: 20 },
    {
      id: "currentJobDescriptionName",
      label: "当前关联岗位",
      value: (row) => row.currentJobDescriptionName,
      width: 24,
    },
    { id: "workYears", label: "工作年限", value: (row) => row.workYears },
    { id: "score", label: "推荐分", value: (row) => row.score },
    {
      id: "reasons",
      label: "推荐理由",
      value: (row) => row.reasons.join("；"),
      width: 48,
    },
    {
      id: "skillRole",
      label: "技能画像相似度",
      value: (row) => formatPercent(row.similarity.skillRole),
    },
    {
      id: "workProject",
      label: "项目职责相似度",
      value: (row) => formatPercent(row.similarity.workProject),
    },
    {
      id: "resumeOverview",
      label: "整体画像相似度",
      value: (row) => formatPercent(row.similarity.resumeOverview),
    },
    {
      id: "masteredSkills",
      label: "技能",
      value: (row) => row.masteredSkills.join("、"),
      width: 36,
    },
    {
      id: "latestCompany",
      label: "最近公司",
      value: (row) => row.profileHighlights.latestCompany,
      width: 24,
    },
    {
      id: "latestProject",
      label: "最近项目",
      value: (row) => row.profileHighlights.latestProject,
      width: 24,
    },
    { id: "education", label: "教育经历", value: formatEducation, width: 36 },
    { id: "resumeFileName", label: "简历文件", value: (row) => row.resumeFileName, width: 32 },
    {
      id: "resumeParseStatus",
      label: "解析状态",
      value: (row) => resumeParseStatusMeta[row.resumeParseStatus].label,
    },
    { id: "createdAt", label: "创建时间", value: (row) => displayDate(row.createdAt), width: 22 },
    { id: "notes", label: "备注", value: (row) => row.notes, width: 40 },
  ];

export const talentRecommendationDefaultColumnIds = [
  "candidateName",
  "candidateEmail",
  "candidatePhone",
  "source",
  "score",
  "reasons",
  "targetRole",
  "currentJobDescriptionName",
] as const;
