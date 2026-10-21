import { describe, expect, it } from "vitest";
import { buildOfferConfirmationText } from "../offer-confirmation";
import type { OfferConfirmationDetails } from "../offer-confirmation";

const completeInfo: OfferConfirmationDetails = {
  candidateCode: "C20260001",
  candidateName: "张三",
  departmentName: "技术部",
  directManager: "李四",
  gender: "男",
  hiringUnitName: "华东事业部",
  interviewFeedback: "技术基础扎实\n沟通清晰，建议录用。",
  interviewRoundId: "round-2",
  jobLevel: "P6",
  jobType: "技术岗",
  mainInterviewerName: "王五",
  managementSequence: "专业序列",
  personnelType: "正式员工",
  probationPeriod: "3个月",
  probationSalary: 10_000,
  serviceUnit: "上海服务中心",
  workLocation: "上海",
  workMode: "现场办公",
};

describe("Offer confirmation text", () => {
  it("includes the complete creation snapshot in the requested field order", () => {
    expect(
      buildOfferConfirmationText({
        baseSalary: 12_000,
        currency: "CNY",
        info: completeInfo,
        position: "高级开发工程师",
        sscConfirmationStatus: "pending",
      }),
    ).toBe(`【offer信息】
候选人编码：C20260001
简历名：张三
性别：男

1️⃣编制信息：
入职编制组织：华东事业部
入职服务单位：上海服务中心
人员性质：正式员工
入职部门：技术部
直属上级：李四
岗位类型：技术岗
职位：高级开发工程师
建议职级：P6
管理序列：专业序列
办公方式：现场办公
办公地区：上海

2️⃣薪资信息
薪资货币：CNY
转正薪资：12K
试用期：3个月
试用薪资：10K

#面试评价：
主要面试官：王五
面试评价：技术基础扎实
沟通清晰，建议录用。

待 SSC 确认`);
  });

  it.each([null, undefined])(
    "keeps every confirmation field visible for a legacy Offer with info %s",
    (info) => {
      expect(
        buildOfferConfirmationText({
          baseSalary: 12_000,
          currency: "CNY",
          info,
          position: "开发工程师",
        }),
      ).toBe(`【offer信息】
候选人编码：待补充
简历名：待补充
性别：待补充

1️⃣编制信息：
入职编制组织：待补充
入职服务单位：待补充
人员性质：待补充
入职部门：待补充
直属上级：待补充
岗位类型：待补充
职位：开发工程师
建议职级：待补充
管理序列：待补充
办公方式：待补充
办公地区：待补充

2️⃣薪资信息
薪资货币：CNY
转正薪资：12K
试用期：待补充
试用薪资：待补充

#面试评价：
主要面试官：待补充
面试评价：待补充

待 SSC 确认`);
    },
  );

  it("marks empty values as missing without dropping numeric zero", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 0,
      currency: "  ",
      info: {
        ...completeInfo,
        candidateCode: null,
        candidateName: "",
        interviewFeedback: " \n ",
        probationSalary: 0,
      },
      position: "",
    });

    expect(text).toContain("候选人编码：待补充\n简历名：待补充");
    expect(text).toContain("职位：待补充");
    expect(text).toContain("薪资货币：待补充\n转正薪资：0K");
    expect(text).toContain("试用薪资：0K");
    expect(text).toContain("面试评价：待补充");
  });

  it("preserves salary precision when amounts are not whole thousands", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_500,
      currency: "USD",
      info: { ...completeInfo, probationSalary: 9750.5 },
      position: "工程师",
    });

    expect(text).toContain("薪资货币：USD\n转正薪资：12.5K");
    expect(text).toContain("试用薪资：9.7505K");
  });

  it("keeps missing Offer amounts and text visible as fields to complete", () => {
    const text = buildOfferConfirmationText({
      baseSalary: null,
      currency: null,
      info: { ...completeInfo, probationSalary: null },
      position: null,
    });

    expect(text).toContain("职位：待补充");
    expect(text).toContain("薪资货币：待补充\n转正薪资：待补充");
    expect(text).toContain("试用薪资：待补充");
  });

  it.each([
    ["pending", "待 SSC 确认"],
    ["confirming", "SSC 确认中"],
    ["completed", "offer审批已通过"],
    [null, "待 SSC 确认"],
    [undefined, "待 SSC 确认"],
  ] as const)("ends with the current SSC state %s", (sscConfirmationStatus, label) => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      currency: "CNY",
      info: completeInfo,
      position: "工程师",
      sscConfirmationStatus,
    });

    expect(text.split("\n").at(-1)).toBe(label);
  });
});
