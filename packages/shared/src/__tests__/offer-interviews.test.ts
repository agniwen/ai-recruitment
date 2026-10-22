import { describe, expect, it } from "vitest";
import { buildOfferConfirmationText } from "../offer-confirmation";
import type { OfferConfirmationDetails } from "../offer-confirmation";

const info: OfferConfirmationDetails = {
  candidateCode: null,
  candidateName: "候选人甲",
  departmentName: null,
  directManager: null,
  gender: null,
  hiringUnitName: null,
  interviewFeedback: "旧 Offer 手填点评",
  interviewRoundId: null,
  jobLevel: null,
  jobType: null,
  mainInterviewerName: "旧快照面试官",
  managementSequence: null,
  personnelType: null,
  probationPeriod: null,
  probationSalary: null,
  serviceUnit: null,
  workLocation: null,
  workMode: null,
};
const offer = { baseSalary: 15_000, currency: "CNY", info, position: "工程师" };
const first = {
  feedback: "技术基础扎实。\n沟通清晰，建议录用。",
  interviewers: [{ name: "内部面试官" }, { name: "外部面试官" }],
  label: "技术初试",
  scheduledAt: "2026-10-21T06:30:00.000Z",
  sortOrder: 8,
  status: "completed",
};
const second = {
  ...first,
  feedback: "业务理解较好。",
  interviewers: [{ name: "复试面试官" }],
  label: "业务复试",
  scheduledAt: "2026-10-22T02:00:00.000Z",
  sortOrder: 1,
};

describe("Offer completed interview information", () => {
  it("includes every completed round in chronological order with the requested fields", () => {
    const text = buildOfferConfirmationText({ ...offer, interviewRounds: [second, first] });
    expect(text).toContain(`【面试情况】
第 1 轮：技术初试
面试时间：2026-10-21 14:30（北京时间）
面试官：内部面试官、外部面试官
面试点评：技术基础扎实。
沟通清晰，建议录用。

第 2 轮：业务复试
面试时间：2026-10-22 10:00（北京时间）
面试官：复试面试官
面试点评：业务理解较好。`);
    expect(text).not.toContain("旧 Offer 手填点评");
    expect(text).not.toContain("旧快照面试官");
  });

  it("excludes pending and cancelled interviews including their private feedback", () => {
    const text = buildOfferConfirmationText({
      ...offer,
      interviewRounds: [
        { ...first, feedback: "待面试点评不应出现", status: "pending" },
        { ...first, feedback: "已取消点评不应出现", status: "cancelled" },
        second,
      ],
    });
    expect(text).toContain("第 1 轮：业务复试");
    expect(text).not.toContain("第 2 轮");
    expect(text).not.toContain("待面试点评不应出现");
    expect(text).not.toContain("已取消点评不应出现");
  });

  it("labels missing or invalid scheduled times instead of substituting evaluation completion", () => {
    const withoutSchedule = {
      ...first,
      completedAt: "2026-10-25T00:00:00.000Z",
      scheduledAt: null,
    };
    const text = buildOfferConfirmationText({
      ...offer,
      interviewRounds: [withoutSchedule, { ...second, scheduledAt: "invalid-date" }],
    });
    expect(text.match(/面试时间：未记录/gu)).toHaveLength(2);
    expect(text).not.toContain("2026-10-25");
    expect(text).not.toContain("Invalid Date");
  });

  it("shows Beijing midnight without relying on the machine time zone", () => {
    const text = buildOfferConfirmationText({
      ...offer,
      interviewRounds: [{ ...first, scheduledAt: "2026-10-22T16:15:00.000Z" }],
    });
    expect(text).toContain("面试时间：2026-10-23 00:15（北京时间）");
  });

  it("keeps unknown times after dated rounds and orders ties stably without mutating input", () => {
    const rounds = [
      { ...first, label: "缺时间二", scheduledAt: null, sortOrder: 2 },
      { ...first, label: "相同时间二", sortOrder: 2 },
      { ...first, label: "缺时间一", scheduledAt: null, sortOrder: 1 },
      { ...first, label: "相同时间一", sortOrder: 1 },
    ];
    const before = structuredClone(rounds);
    const text = buildOfferConfirmationText({ ...offer, interviewRounds: rounds });
    expect(text.indexOf("第 1 轮：相同时间一")).toBeGreaterThan(-1);
    expect(text.indexOf("第 2 轮：相同时间二")).toBeGreaterThan(-1);
    expect(text.indexOf("第 3 轮：缺时间一")).toBeGreaterThan(-1);
    expect(text.indexOf("第 4 轮：缺时间二")).toBeGreaterThan(-1);
    expect(rounds).toEqual(before);
  });

  it("explicitly identifies no completed interviews rather than reviving old snapshot feedback", () => {
    const text = buildOfferConfirmationText({ ...offer, interviewRounds: [] });
    expect(text).toContain("【面试情况】\n暂无已完成的真人面试记录。");
    expect(text).not.toContain("旧 Offer 手填点评");
  });

  it("makes missing names and feedback explicit while retaining all named interviewers", () => {
    const text = buildOfferConfirmationText({
      ...offer,
      interviewRounds: [
        { ...first, feedback: " \n ", interviewers: [], label: " " },
        { ...second, interviewers: [{ name: "  内部面试官  " }, { name: null }] },
      ],
    });
    expect(text).toContain("第 1 轮：真人面试");
    expect(text).toContain("面试官：未记录\n面试点评：未填写");
    expect(text).toContain("面试官：内部面试官、未记录");
  });

  it.each(["pending", "confirming", "completed"] as const)(
    "preserves full long multiline feedback and the SSC state for %s",
    (sscConfirmationStatus) => {
      const feedback = `作品分析\n${"多行点评🙂 [保留原文]".repeat(600)}\n点评结束`;
      const text = buildOfferConfirmationText({
        ...offer,
        interviewRounds: [{ ...first, feedback }],
        sscConfirmationStatus,
      });
      expect(text).toContain(feedback);
      expect(text).not.toContain("待 SSC 确认");
      expect(text.endsWith("\n")).toBe(false);
      if (sscConfirmationStatus === "confirming") {
        expect(text).not.toContain("SSC 确认中");
        expect(text).toMatch(/点评结束$/u);
      }
      if (sscConfirmationStatus === "completed") {
        expect(text).toMatch(/offer审批已通过$/u);
      }
      if (sscConfirmationStatus === "pending") {
        expect(text).toMatch(/点评结束$/u);
      }
    },
  );
});
