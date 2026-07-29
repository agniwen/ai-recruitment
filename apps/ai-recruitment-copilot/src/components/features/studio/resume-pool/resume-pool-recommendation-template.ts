export interface ResumePoolRecommendationTemplateValues {
  candidateContact?: string | null;
  candidateName?: string | null;
  currentLocation?: string | null;
  currentSalary?: string | null;
  expectedOnboardAt?: string | null;
  expectedSalary?: string | null;
  hasDiscussedIndustryBackground?: string | null;
  hasDiscussedWorkLocation?: string | null;
  hiringUnitName?: string | null;
  jobDescriptionName?: string | null;
  jobSeries?: string | null;
  recruiterChannel?: string | null;
  recruitmentSource?: string | null;
  referrerName?: string | null;
  resumeContact?: string | null;
  serviceUnit?: string | null;
  workYears?: number | null;
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function formatWorkYears(workYears: number | null | undefined): string {
  if (workYears === null || workYears === undefined) {
    return "";
  }
  return `${workYears}年`;
}

function formatOrgSeriesServiceUnit(values: ResumePoolRecommendationTemplateValues): string {
  return [values.hiringUnitName, values.jobSeries, values.serviceUnit]
    .map((part) => text(part))
    .filter(Boolean)
    .join("/");
}

/**
 * 入库招聘台时的「推荐语」模版。有数据的字段自动填入，其余留给人工补全。
 */
export function buildResumePoolRecommendationTemplate(
  values: ResumePoolRecommendationTemplateValues,
): string {
  return [
    "推荐简历",
    `候选人姓名：${text(values.candidateName)}`,
    `应聘岗位：${text(values.jobDescriptionName)}`,
    `工作年限：${formatWorkYears(values.workYears)}`,
    `当前薪资：${text(values.currentSalary)}`,
    `期望薪资：${text(values.expectedSalary)}`,
    `目前所在地：${text(values.currentLocation)}`,
    `预计可到岗时间：${text(values.expectedOnboardAt)}`,
    `是否已沟通工作地点：${text(values.hasDiscussedWorkLocation)}`,
    `是否已沟通行业背景要求：${text(values.hasDiscussedIndustryBackground)}`,
    `推荐编制组织/序列/服务单位：${formatOrgSeriesServiceUnit(values)}`,
    `招聘渠道：${text(values.recruiterChannel)}`,
    `简历推荐人：${text(values.referrerName)}`,
    `简历来源：${text(values.recruitmentSource)}`,
    `候选人联系方式：${text(values.candidateContact)}`,
    `简历对接BP：${text(values.resumeContact)}`,
  ].join("\n");
}
