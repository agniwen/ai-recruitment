import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEvaluationRejectionNotification,
  notifyEvaluationRejection,
} from "./evaluation-notification";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  creatorRecipients: vi.fn(),
  post: vi.fn(),
  recruitingRecipients: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/bot", () => ({
  isTelegramBotConfigured: mocks.configured,
  postTelegramDirectMessage: mocks.post,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-stage-notification",
  () => ({
    buildCandidateDetailUrl: (candidateId: string, slug: string) =>
      `https://example.com/w/${slug}/studio/resumes/${candidateId}`,
    resolveCandidateRecruitingNotificationRecipientIds: mocks.recruitingRecipients,
    resolveCandidateStageNotificationRecipientIds: mocks.creatorRecipients,
  }),
);

function mockCandidateQuery() {
  const query = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([
      {
        candidateName: "候选人甲",
        jobDescriptionName: "后端工程师",
        organizationName: "招聘主体",
        organizationSlug: "test-fatman",
        resumeContact: "@recruiter",
        telegram: "@fatman",
        telegramBoundUsername: "guguda1643",
        telegramChatId: "creator-chat",
      },
    ]),
    where: vi.fn().mockReturnThis(),
  };
  mocks.select.mockReturnValue(query);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.post.mockResolvedValue(null);
  mockCandidateQuery();
});

describe("buildEvaluationRejectionNotification", () => {
  it("builds a dedicated AI review rejection card", () => {
    const card = buildEvaluationRejectionNotification({
      candidateName: "张三",
      detailUrl: "https://example.com/candidate/1",
      jobDescriptionName: "产品经理",
      kind: "ai_review",
      operatorName: "ODC甲",
      organizationName: "示例公司",
      reason: "评价依据不足",
    });

    expect(card).toMatchObject({
      children: [
        {
          children: expect.arrayContaining([
            { label: "审核人", type: "field", value: "ODC甲" },
            { label: "审核结果", type: "field", value: "不通过" },
            { label: "原因", type: "field", value: "评价依据不足" },
          ]),
          type: "fields",
        },
        { type: "divider" },
        {
          children: [
            {
              label: "查看候选人详情",
              type: "link-button",
              url: "https://example.com/candidate/1",
            },
          ],
          type: "actions",
        },
      ],
      title: "⚠️ AI 评价审核未通过",
      type: "card",
    });
  });

  it("uses the resume-evaluation title and a fallback reason", () => {
    expect(
      buildEvaluationRejectionNotification({
        candidateName: "李四",
        detailUrl: null,
        jobDescriptionName: null,
        kind: "resume_evaluation",
        operatorName: "评审人",
        organizationName: "示例公司",
        reason: " ",
      }),
    ).toMatchObject({
      children: [
        {
          children: expect.arrayContaining([
            { label: "评估结果", type: "field", value: "不通过" },
            { label: "原因", type: "field", value: "未填写" },
          ]),
        },
      ],
      title: "⚠️ 简历评估未通过",
    });
  });
});

describe("notifyEvaluationRejection", () => {
  it("notifies creator and resume contact for an AI review rejection", async () => {
    mocks.recruitingRecipients.mockResolvedValue(["creator-chat", "contact-chat"]);

    await notifyEvaluationRejection({
      candidateId: "candidate-1",
      kind: "ai_review",
      operatorName: "ODC甲",
      organizationId: "org-1",
      reason: "评价不完整",
    });

    expect(mocks.recruitingRecipients).toHaveBeenCalledWith({
      creator: expect.objectContaining({ telegramChatId: "creator-chat" }),
      organizationId: "org-1",
      resumeContact: "@recruiter",
    });
    expect(mocks.creatorRecipients).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("notifies only the bound creator for a failed resume evaluation", async () => {
    mocks.creatorRecipients.mockReturnValue(["creator-chat"]);

    await notifyEvaluationRejection({
      candidateId: "candidate-1",
      kind: "resume_evaluation",
      operatorName: "评审人",
      organizationId: "org-1",
      reason: "经验不匹配",
    });

    expect(mocks.creatorRecipients).toHaveBeenCalledWith([
      expect.objectContaining({ telegramChatId: "creator-chat" }),
    ]);
    expect(mocks.recruitingRecipients).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith(
      "creator-chat",
      expect.objectContaining({ title: "⚠️ 简历评估未通过" }),
    );
  });

  it("keeps the mutation successful when Telegram delivery fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.creatorRecipients.mockReturnValue(["creator-chat"]);
    mocks.post.mockRejectedValue(new Error("Telegram unavailable"));
    try {
      await expect(
        notifyEvaluationRejection({
          candidateId: "candidate-1",
          kind: "resume_evaluation",
          operatorName: "评审人",
          organizationId: "org-1",
          reason: "不通过",
        }),
      ).resolves.toBeUndefined();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
