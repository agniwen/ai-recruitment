export interface ResumePoolRecommendationTemplateValues {
  candidateContact?: string | null;
  candidateName?: string | null;
  hiringUnitName?: string | null;
  jobDescriptionName?: string | null;
  recruitmentSource?: string | null;
  resumeContact?: string | null;
  workYears?: number | null;
}

export function buildResumePoolRecommendationTemplate(
  values: ResumePoolRecommendationTemplateValues,
): string {
  const workYears =
    values.workYears === null || values.workYears === undefined ? "" : `${values.workYears} 年`;
  const candidateContact = values.candidateContact?.trim() || "@TG号";
  const resumeContact = values.resumeContact?.trim() || "@TG号";
  const recruitmentSource = values.recruitmentSource?.trim();

  return [
    `候选人姓名： ${values.candidateName?.trim() ?? ""}`,
    `应聘岗位：${values.jobDescriptionName?.trim() ?? ""}（需与《招聘需求表》中的岗位名称保持一致）`,
    `工作年限： ${workYears}`,
    "当前薪资： ",
    "期望薪资： ",
    "目前所在地： ",
    "预计可到岗时间： ",
    "是否已沟通工作地点： ",
    "是否已沟通行业背景要求： ",
    `推荐编制/组织/服务单位： ${values.hiringUnitName?.trim() ?? ""}`,
    "（以上三项需与《招聘需求表》保持一致） ",
    "招聘渠道：（如：中诚、卓亚等） ",
    `简历来源：${recruitmentSource ? `${recruitmentSource} ` : ""}（如：TG、小红书、猎聘、BOSS等） `,
    `候选人联系方式：${candidateContact}`,
    `简历对接BP：${resumeContact}`,
  ].join("\n");
}
