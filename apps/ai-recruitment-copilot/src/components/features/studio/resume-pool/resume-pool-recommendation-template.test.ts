import { describe, expect, it } from "vitest";
import { buildResumePoolRecommendationTemplate } from "./resume-pool-recommendation-template";

describe("buildResumePoolRecommendationTemplate", () => {
  it("preserves the template line breaks and fills known values", () => {
    const result = buildResumePoolRecommendationTemplate({
      candidateContact: "@candidate",
      candidateName: "张三",
      hiringUnitName: "研发中心",
      jobDescriptionName: "高级前端工程师",
      recruitmentSource: "内推",
      resumeContact: "@bp",
      workYears: 5,
    });

    expect(result.split("\n")).toHaveLength(15);
    expect(result).toContain("候选人姓名： 张三\n应聘岗位：高级前端工程师");
    expect(result).toContain("工作年限： 5 年");
    expect(result).toContain("推荐编制/组织/服务单位： 研发中心");
    expect(result).toContain("招聘渠道：（如：中诚、卓亚等）");
    expect(result).toContain("简历来源：内推 （如：TG、小红书、猎聘、BOSS等）");
    expect(result).toContain("候选人联系方式：@candidate\n简历对接BP：@bp");
  });
});
