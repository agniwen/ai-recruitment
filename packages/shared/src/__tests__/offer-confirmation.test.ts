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
  const completionInfo = {
    candidateCode: "C20260001",
    candidateName: "张三",
    candidatePrivateTelegram: "@candidate_private",
    preboardingDate: "2026-11-01",
    recruiterTelegram: "@recruiter_source",
    recruitingGroupNames: ["中诚渠道", "招聘二组"],
    recruitmentChannel: "TG",
    resumeSource: "林图",
  };

  it("adds completed recruitment and preboarding sections to the same full Offer text", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      completionInfo,
      currency: "CNY",
      info: completeInfo,
      interviewRounds: [],
      position: "工程师",
      sscConfirmationStatus: "completed",
    });
    expect(text).toContain(`3️⃣招聘信息
招聘渠道：中诚渠道、招聘二组
简历来源：林图
招聘通道：TG
招聘专员／内推人联系方式：TG—@recruiter_source

4️⃣入职信息
候选人编码：C20260001
候选人姓名：张三
入职日期：2026-11-01
候选人联系方式：@candidate_private`);
    expect(text.indexOf("2️⃣薪资信息")).toBeLessThan(text.indexOf("3️⃣招聘信息"));
    expect(text.indexOf("4️⃣入职信息")).toBeLessThan(text.indexOf("【面试情况】"));
    expect(text.split("\n").at(-1)).toBe("offer审批已通过");
  });

  it("includes recruitment and entry previews while confirmation is pending without claiming approval", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      completionInfo,
      currency: "CNY",
      info: completeInfo,
      interviewRounds: [],
      position: "工程师",
      sscConfirmationStatus: "confirming",
    });
    expect(text).toContain("3️⃣招聘信息\n招聘渠道：中诚渠道、招聘二组");
    expect(text).toContain("4️⃣入职信息\n候选人编码：C20260001");
    expect(text).toContain("入职日期：2026-11-01");
    expect(text).toContain("候选人联系方式：@candidate_private");
    expect(text.indexOf("4️⃣入职信息")).toBeLessThan(text.indexOf("【面试情况】"));
    expect(text).not.toContain("offer审批已通过");
    expect(text).not.toContain("SSC 确认中");
  });

  it("does not invent recruitment or entry previews before a date has generated their data", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      completionInfo: null,
      currency: "CNY",
      info: completeInfo,
      position: "工程师",
      sscConfirmationStatus: "confirming",
    });
    expect(text).not.toContain("3️⃣招聘信息");
    expect(text).not.toContain("4️⃣入职信息");
    expect(text).not.toContain("offer审批已通过");
  });

  it.each(["pending", null, undefined] as const)(
    "does not expose recruitment or entry details before SSC receipt for status %s",
    (sscConfirmationStatus) => {
      const text = buildOfferConfirmationText({
        baseSalary: 12_000,
        completionInfo,
        currency: "CNY",
        info: completeInfo,
        position: "工程师",
        sscConfirmationStatus,
      });
      expect(text).not.toContain("3️⃣招聘信息");
      expect(text).not.toContain("4️⃣入职信息");
    },
  );

  it("keeps missing completion data explicit without inventing a recruitment channel", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      completionInfo: {
        ...completionInfo,
        candidateCode: null,
        candidatePrivateTelegram: null,
        recruiterTelegram: null,
        recruitingGroupNames: [],
        recruitmentChannel: null,
        resumeSource: null,
      },
      currency: "CNY",
      info: completeInfo,
      position: "工程师",
      sscConfirmationStatus: "completed",
    });
    expect(text).toContain("招聘渠道：待补充\n简历来源：待补充\n招聘通道：待补充");
    expect(text).toContain("招聘专员／内推人联系方式：待补充");
    expect(text).toContain("4️⃣入职信息\n候选人编码：未填写");
    expect(text).toContain("候选人联系方式：待补充");
  });

  it("includes the confirmed private Telegram in the full Offer copy text", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      currency: "CNY",
      info: { ...completeInfo, candidatePrivateTelegram: "@Candidate_123" },
      position: "工程师",
    });
    expect(text).toContain("简历名：张三\n性别：男\n候选人私人 TG：@Candidate_123");
  });

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
沟通清晰，建议录用。`);
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
候选人编码：未填写
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
试用薪资：待补充`);
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

    expect(text).toContain("候选人编码：未填写\n简历名：待补充");
    expect(text).toContain("职位：待补充");
    expect(text).toContain("薪资货币：待补充\n转正薪资：0K");
    expect(text).toContain("试用薪资：0K");
    expect(text).toContain("面试评价：待补充");
  });

  it("shows the system record code separately from the optional business code", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      candidateRecordId: "a523d505-cd0c-43c1-a2e5-7525e8cadde8",
      currency: "CNY",
      info: completeInfo,
      position: "工程师",
    });
    expect(text).toContain("系统记录编码：a523d505-cd0c-43c1-a2e5-7525e8cadde8");
    expect(text).toContain("候选人编码：C20260001");
  });

  it("omits unused interview placeholders for an Offer without interview content", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      currency: "CNY",
      info: {
        ...completeInfo,
        candidateCode: null,
        interviewFeedback: null,
        mainInterviewerName: null,
      },
      position: "工程师",
    });
    expect(text).toContain("候选人编码：未填写");
    expect(text).not.toContain("#面试评价");
    expect(text).not.toContain("主要面试官");
    expect(text).not.toContain("系统记录编码：");
    expect(text).not.toContain("待 SSC 确认");
    expect(text.split("\n").at(-1)).toBe("试用薪资：10K");
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

  it.each([["completed", "offer审批已通过"]] as const)(
    "ends with the current SSC state %s",
    (sscConfirmationStatus, label) => {
      const text = buildOfferConfirmationText({
        baseSalary: 12_000,
        currency: "CNY",
        info: completeInfo,
        position: "工程师",
        sscConfirmationStatus,
      });

      expect(text.split("\n").at(-1)).toBe(label);
    },
  );

  it.each(["pending", "confirming", null, undefined] as const)(
    "omits the pending SSC footer and trailing blank lines for status %s",
    (sscConfirmationStatus) => {
      const text = buildOfferConfirmationText({
        baseSalary: 12_000,
        currency: "CNY",
        info: completeInfo,
        position: "工程师",
        sscConfirmationStatus,
      });
      expect(text).not.toContain("待 SSC 确认");
      expect(text).not.toContain("SSC 确认中");
      expect(text.split("\n").at(-1)).toBe("沟通清晰，建议录用。");
      expect(text.endsWith("\n")).toBe(false);
    },
  );

  it("preserves pending SSC wording inside saved interview content", () => {
    const text = buildOfferConfirmationText({
      baseSalary: 12_000,
      currency: "CNY",
      info: { ...completeInfo, interviewFeedback: "待 SSC 确认后联系候选人。\n保留面试记录。" },
      position: "工程师",
      sscConfirmationStatus: "pending",
    });
    expect(text).toContain("面试评价：待 SSC 确认后联系候选人。\n保留面试记录。");
    expect(text.split("\n").at(-1)).toBe("保留面试记录。");
  });
});
