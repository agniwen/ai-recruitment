import { describe, expect, it } from "vitest";
import { buildResumePoolRecommendationTemplate } from "./resume-pool-recommendation-template";

describe("buildResumePoolRecommendationTemplate", () => {
  it("builds the recommendation copy with filled resume and job fields", () => {
    const result = buildResumePoolRecommendationTemplate({
      candidateContact: "@zhatt008777",
      candidateName: "张三",
      currentLocation: "中国大陆",
      currentSalary: "35K×14",
      expectedOnboardAt: "30天",
      expectedSalary: "45K×14",
      hasDiscussedIndustryBackground: "是",
      hasDiscussedWorkLocation: "是",
      hiringUnitName: "运营中心",
      jobDescriptionName: "中级运营专员",
      jobSeries: "派驻",
      recruiterChannel: "宏景",
      recruitmentSource: "TG",
      referrerName: "李四",
      resumeContact: "@BP_A",
      serviceUnit: "悦达",
      workYears: 8,
    });

    expect(result).toBe(
      [
        "推荐简历",
        "候选人姓名：张三",
        "应聘岗位：中级运营专员",
        "工作年限：8年",
        "当前薪资：35K×14",
        "期望薪资：45K×14",
        "目前所在地：中国大陆",
        "预计可到岗时间：30天",
        "是否已沟通工作地点：是",
        "是否已沟通行业背景要求：是",
        "推荐编制组织/序列/服务单位：运营中心/派驻/悦达",
        "招聘渠道：宏景",
        "简历推荐人：李四",
        "简历来源：TG",
        "候选人联系方式：@zhatt008777",
        "简历对接BP：@BP_A",
      ].join("\n"),
    );
  });

  it("keeps unknown fields empty for manual completion", () => {
    const result = buildResumePoolRecommendationTemplate({
      candidateName: "王五",
      hiringUnitName: "研发中心",
      jobDescriptionName: "后端工程师",
      recruitmentSource: "Boss直聘",
      workYears: 3,
    });

    expect(result).toContain("推荐简历\n候选人姓名：王五");
    expect(result).toContain("工作年限：3年");
    expect(result).toContain("当前薪资：\n期望薪资：");
    expect(result).toContain("推荐编制组织/序列/服务单位：研发中心");
    expect(result).toContain("招聘渠道：\n简历推荐人：\n简历来源：Boss直聘");
  });
});
