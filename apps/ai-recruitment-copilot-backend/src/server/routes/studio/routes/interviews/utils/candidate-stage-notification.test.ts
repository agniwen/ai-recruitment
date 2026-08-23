import { describe, expect, it } from "vitest";
import {
  buildCandidateStageNotification,
  resolveCandidateStageNotificationRecipientIds,
} from "./candidate-stage-notification";

describe("buildCandidateStageNotification", () => {
  it("builds a Telegram card with recruiting context and a detail action", () => {
    expect(
      buildCandidateStageNotification({
        candidateName: "张三",
        departmentName: "技术部",
        detailUrl: "https://example.com/w/acme/studio/resumes/candidate-1",
        fromOutcome: "in_pipeline",
        fromStage: "screening",
        hiringUnitName: "产品研发中心",
        jobDescriptionName: "后端工程师",
        organizationName: "示例科技",
        toOutcome: "in_pipeline",
        toStage: "ai_interview",
      }),
    ).toEqual({
      children: [
        {
          children: [
            { label: "候选人", type: "field", value: "张三" },
            { label: "岗位", type: "field", value: "后端工程师" },
            { label: "部门", type: "field", value: "技术部" },
            { label: "招聘主体", type: "field", value: "示例科技" },
            { label: "用人组织", type: "field", value: "产品研发中心" },
            { label: "阶段变化", type: "field", value: "简历筛选 → AI 面试" },
            { label: "候选人状态", type: "field", value: "进行中" },
          ],
          type: "fields",
        },
        { type: "divider" },
        {
          children: [
            {
              label: "查看候选人详情",
              type: "link-button",
              url: "https://example.com/w/acme/studio/resumes/candidate-1",
            },
          ],
          type: "actions",
        },
      ],
      title: "📋 候选人状态更新",
      type: "card",
    });
  });

  it("uses clear fallbacks and includes a changed terminal outcome", () => {
    const card = buildCandidateStageNotification({
      candidateName: "李四",
      departmentName: null,
      detailUrl: null,
      fromOutcome: "in_pipeline",
      fromStage: "offer",
      hiringUnitName: null,
      jobDescriptionName: null,
      organizationName: "示例科技",
      toOutcome: "hired",
      toStage: "closed",
    });

    expect(card.children).toHaveLength(1);
    expect(card.children[0]).toMatchObject({
      children: expect.arrayContaining([
        { label: "岗位", type: "field", value: "未关联岗位" },
        { label: "部门", type: "field", value: "未关联部门" },
        { label: "用人组织", type: "field", value: "未分配用人组织" },
        { label: "候选人状态", type: "field", value: "进行中 → 已到岗" },
      ]),
      type: "fields",
    });
  });
});

describe("resolveCandidateStageNotificationRecipientIds", () => {
  it("includes both uploader and resume contact while deduplicating the same chat", () => {
    expect(
      resolveCandidateStageNotificationRecipientIds([
        {
          telegram: "@uploader",
          telegramBoundUsername: "uploader",
          telegramChatId: "10001",
        },
        {
          telegram: "@contact",
          telegramBoundUsername: "contact",
          telegramChatId: "10002",
        },
        {
          telegram: "@uploader",
          telegramBoundUsername: "uploader",
          telegramChatId: "10001",
        },
      ]),
    ).toEqual(["10001", "10002"]);
  });

  it("ignores recipients that have not completed Telegram binding", () => {
    expect(
      resolveCandidateStageNotificationRecipientIds([
        {
          telegram: "@contact",
          telegramBoundUsername: null,
          telegramChatId: null,
        },
      ]),
    ).toEqual([]);
  });
});
