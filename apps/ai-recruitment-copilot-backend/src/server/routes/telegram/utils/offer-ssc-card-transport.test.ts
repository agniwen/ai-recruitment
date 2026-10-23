import { createOfferTelegramAdapter } from "./offer-telegram-adapter";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { buildOfferConfirmationText } from "@arc/shared/offer-confirmation";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import type { OfferInterviewRound } from "@arc/shared/offer-interviews";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTelegramOfferCard,
  buildTelegramOfferCompletionCard,
  telegramOfferCallbackValue,
} from "./offer-ssc-card";

interface EditRequest {
  chat_id: string | number;
  message_id: number;
  parse_mode?: string;
  reply_markup: {
    inline_keyboard: {
      callback_data?: string;
      copy_text?: { text: string };
      text: string;
      url?: string;
    }[][];
  };
  text?: string;
}

const requests: EditRequest[] = [];
const chatId = "12345";
const messageId = 7;
const draftId = "550e8400-e29b-41d4-a716-446655440000";
const completedInterviewRounds: readonly OfferInterviewRound[] = [
  {
    feedback: "能清楚说明方案与取舍，建议录用。",
    interviewers: [{ name: "技术面试官甲" }, { name: "外部面试官乙" }],
    label: "技术复面",
    scheduledAt: "2026-10-20T02:30:00.000Z",
    sortOrder: 1,
    status: "completed",
  },
];
const botUser = {
  first_name: "Transport test bot",
  id: 999_999,
  is_bot: true,
  username: "transport_test_bot",
};

beforeEach(() => {
  requests.length = 0;
  // Every HTTP request is handled here; unexpected methods fail without network access.
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = url.pathname.split("/").at(-1);
      if (method === "getMe") {
        return Promise.resolve(Response.json({ ok: true, result: botUser }));
      }
      if (
        !["sendMessage", "editMessageText"].includes(method ?? "") ||
        typeof init?.body !== "string"
      ) {
        throw new Error("Unexpected Telegram transport request in isolated test");
      }
      const payload = JSON.parse(init.body) as EditRequest;
      requests.push(payload);
      return Promise.resolve(
        Response.json({
          ok: true,
          result: {
            chat: { first_name: "SSC test user", id: Number(payload.chat_id), type: "private" },
            date: 1_700_000_000,
            from: botUser,
            message_id: payload.message_id ?? messageId,
            text: payload.text ?? "Transport test card",
          },
        }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function editedCard(
  status: "pending" | "confirming" | "completed",
  overrides: Partial<OfferDraftRecord> = {},
  options: Parameters<typeof buildTelegramOfferCard>[1] = {},
  interviewRounds?: readonly OfferInterviewRound[],
) {
  const adapter = createOfferTelegramAdapter({
    botToken: "999999:fake-transport-test-token",
    mode: "webhook",
    secretToken: "fake-transport-test-secret",
    userName: botUser.username,
  });
  const card = buildTelegramOfferCard(
    {
      canConfirm: true,
      canReceive: true,
      candidateName: "Transport test candidate",
      draft: {
        id: draftId,
        position: "Transport test role",
        sscConfirmationStatus: status,
        sscRevision: 2_147_483_647,
        status: "draft",
        version: 3,
        ...overrides,
      },
      interviewRounds,
      pipelineStage: "offer",
    },
    options,
  );
  await adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ chat_id: chatId, message_id: messageId });
  return requests[0];
}

function copiedBlock(payload: EditRequest) {
  const match = /```[^\n]*\n([\s\S]*?)\n```/u.exec(payload.text ?? "");
  expect(match, "one complete Telegram preformatted block").not.toBeNull();
  expect((payload.text ?? "").match(/^```/gmu)).toHaveLength(2);
  return match?.[1].replaceAll(/\\([\\`])/gu, "$1");
}

describe("Offer SSC cards through the real Telegram adapter", () => {
  it.each([
    ["post", false],
    ["edit", false],
    ["post", true],
    ["edit", true],
  ] as const)(
    "preserves literal emoji templates in the complete Offer on %s (plain retry: %s)",
    async (operation, plainRetry) => {
      if (plainRetry) {
        const defaultFetch = vi.mocked(fetch).getMockImplementation();
        if (!defaultFetch) {
          throw new Error("Missing isolated Telegram fetch implementation");
        }
        let rejectedMarkdown = false;
        vi.mocked(fetch).mockImplementation((input, init) => {
          if (!rejectedMarkdown && typeof init?.body === "string") {
            const payload = JSON.parse(init.body) as EditRequest;
            if (payload.parse_mode === "MarkdownV2") {
              requests.push(payload);
              rejectedMarkdown = true;
              return Promise.resolve(
                Response.json(
                  {
                    description: "Bad Request: can't parse entities: malformed MarkdownV2 entity",
                    error_code: 400,
                    ok: false,
                  },
                  { status: 400 },
                ),
              );
            }
          }
          return defaultFetch(input, init);
        });
      }
      const adapter = createOfferTelegramAdapter({
        botToken: "999999:fake-transport-test-token",
        mode: "webhook",
        secretToken: "fake-transport-test-secret",
        userName: botUser.username,
      });
      const info = offerConfirmationDetailsSchema.parse({
        candidateName: "原文测试候选人",
        interviewFeedback:
          "原文 {{emoji:smile}}\r\n{{emoji:unknown_template}} :smile: \\ 与 ```代码``` $& $` $'",
      });
      const draft = {
        baseSalary: 15_000,
        confirmationInfo: info,
        currency: "CNY" as const,
        id: draftId,
        position: "工程师",
        sscConfirmationStatus: "pending" as const,
        status: "draft" as const,
        version: 3,
      };
      const card = buildTelegramOfferCard({
        canConfirm: true,
        canReceive: true,
        candidateName: "原文测试候选人",
        draft,
        pipelineStage: "offer",
      });
      await (operation === "post"
        ? adapter.postMessage(`telegram:${chatId}`, card)
        : adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card));
      expect(requests).toHaveLength(plainRetry ? 2 : 1);
      const expected = buildOfferConfirmationText({ ...draft, info });
      expect(copiedBlock(requests[0])).toBe(expected);
      if (plainRetry) {
        expect(requests[1].parse_mode).toBeUndefined();
        expect(requests[1].text).toContain(expected);
      }
      for (const payload of requests) {
        expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
          expect.objectContaining({ text: "接收确认" }),
        );
      }
    },
  );

  it("renders the complete Offer snapshot inside one copyable block without truncation", async () => {
    const info = offerConfirmationDetailsSchema.parse({
      candidateCode: "SSC-001",
      candidateName: "候选人<甲>&乙",
      departmentName: "研发中心",
      directManager: "负责人 `甲` 与 \\测试",
      hiringUnitName: "技术 *组织* [资料](https://example.test) #1",
      interviewFeedback: "审阅记录\n```\n正文中仍保留这一行\n```\n- 条目 *原文*\n# 原始标题\n结束",
      probationPeriod: "2个月",
      probationSalary: 10_000,
    });
    const expected = buildOfferConfirmationText({
      baseSalary: 15_000,
      candidateRecordId: "candidate-record-id",
      currency: "CNY",
      info,
      position: "工程师\n```\n职位尾部",
      sscConfirmationStatus: "pending",
    });
    expect(expected.length).toBeGreaterThan(256);
    const payload = await editedCard(
      "pending",
      {
        baseSalary: 15_000,
        confirmationInfo: info,
        currency: "CNY",
        interviewRecordId: "candidate-record-id",
        position: "工程师\n```\n职位尾部",
      },
      { detailUrl: "https://ats.example.test/offer-candidate/signed-offer" },
    );
    expect(payload.parse_mode).toBe("MarkdownV2");
    expect(copiedBlock(payload)).toBe(expected);
    expect(payload.text).toContain("转正薪资：15K\n试用期：2个月\n试用薪资：10K");
    const copies = payload.reply_markup.inline_keyboard.flat().filter((button) => button.copy_text);
    expect(copies).toEqual([]);
    expect(payload.text).toContain("文本块");
    expect(payload.reply_markup.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callback_data: expect.stringContaining('"a":"osr"'),
          text: "接收确认",
        }),
        expect.objectContaining({
          text: "查看候选人详情",
          url: "https://ats.example.test/offer-candidate/signed-offer",
        }),
      ]),
    );
  });

  it.each([
    ["pending", "接收确认", "osr"],
    ["confirming", "完成确认", "osc"],
    ["completed", null, null],
  ] as const)(
    "keeps %s workflow and whole-message copying without a separate full-copy page button",
    async (status, actionLabel, actionId) => {
      const info = offerConfirmationDetailsSchema.parse({
        candidateName: "SSC 流程候选人",
        hiringUnitName: "渠道中心",
        probationPeriod: "2个月",
        probationSalary: 10_000,
      });
      const expected = buildOfferConfirmationText({
        baseSalary: 15_000,
        candidateRecordId: "workflow-candidate",
        currency: "CNY",
        info,
        interviewRounds: completedInterviewRounds,
        position: "工程师",
        sscConfirmationStatus: status,
      });
      const detailUrl = "https://ats.example.test/offer-candidate/workflow";
      const payload = await editedCard(
        status,
        {
          baseSalary: 15_000,
          confirmationInfo: info,
          currency: "CNY",
          interviewRecordId: "workflow-candidate",
          position: "工程师",
        },
        { detailUrl },
        completedInterviewRounds,
      );
      const buttons = payload.reply_markup.inline_keyboard.flat();
      const copies = buttons.filter((button) => button.copy_text);
      expect(copies).toEqual([]);
      expect(payload.text).toContain("文本块");
      expect(copiedBlock(payload)).toBe(expected);
      expect(expected).toContain("技术面试官甲");
      expect(expected).toContain("外部面试官乙");
      expect(expected).toContain("10:30");
      expect(payload.text).toContain("建议录用");
      expect(buttons.filter((button) => button.url)).toEqual([
        { text: "查看候选人详情", url: detailUrl },
      ]);
      expect(buttons.map((button) => button.text)).not.toContain("打开全文复制页");
      const workflow = buttons.filter((button) => button.callback_data);
      if (actionLabel && actionId) {
        expect(workflow).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              callback_data: expect.stringContaining(`"a":"${actionId}"`),
              text: actionLabel,
            }),
          ]),
        );
        expect(workflow).toHaveLength(status === "confirming" ? 2 : 1);
      } else {
        expect(workflow).toEqual([]);
      }
    },
  );

  it("copies completed recruitment and preboarding details together with the Offer and interviews", async () => {
    const info = offerConfirmationDetailsSchema.parse({
      candidateName: "候选人甲",
      candidatePrivateTelegram: "@candidate_private",
    });
    const completionInfo = {
      candidateCode: "ZYHSQ00198",
      candidateName: "候选人甲",
      candidatePrivateTelegram: "@candidate_private",
      preboardingDate: "2026-11-08",
      recruiterTelegram: "@recruiter_private",
      recruitingGroupNames: ["中诚渠道"],
      recruitmentChannel: "TG",
      resumeSource: "上传来源",
    };
    const payload = await editedCard(
      "completed",
      {
        baseSalary: 15_000,
        completionInfo,
        confirmationInfo: info,
        currency: "CNY",
        interviewRecordId: "candidate-a",
        position: "工程师",
        preboardingDate: completionInfo.preboardingDate,
      },
      { detailUrl: "https://ats.example.test/offer-candidate/final" },
      completedInterviewRounds,
    );
    const expected = buildOfferConfirmationText({
      baseSalary: 15_000,
      candidateRecordId: "candidate-a",
      completionInfo,
      currency: "CNY",
      info,
      interviewRounds: completedInterviewRounds,
      position: "工程师",
      sscConfirmationStatus: "completed",
    });
    expect(copiedBlock(payload)).toBe(expected);
    expect(expected).toContain("3️⃣招聘信息");
    expect(expected).toContain("4️⃣入职信息");
    expect(expected).toContain("@recruiter_private");
    expect(expected).toContain("2026-11-08");
    expect(expected).toContain("技术面试官甲");
  });

  it("uses the detail fallback for long completed interview feedback without partial native copies", async () => {
    const feedback = "面试评价长内容".repeat(500);
    const detailUrl = "https://ats.example.test/offer-candidate/long-interviews";
    const payload = await editedCard(
      "pending",
      { baseSalary: 15_000, currency: "CNY", interviewRecordId: "interview-long" },
      { detailUrl },
      [{ ...completedInterviewRounds[0], feedback }],
    );
    const buttons = payload.reply_markup.inline_keyboard.flat();
    expect(payload.text).toContain("信息较长");
    expect(payload.text).toContain("查看候选人详情");
    expect(payload.text).not.toContain(feedback.slice(0, 60));
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(buttons.some((button) => button.copy_text)).toBe(false);
    expect(buttons).toContainEqual(expect.objectContaining({ text: "接收确认" }));
    expect(buttons.filter((button) => button.url)).toEqual([
      { text: "查看候选人详情", url: detailUrl },
    ]);
  });

  it("uses the saved current status in the copied Offer after confirmation", async () => {
    const info = offerConfirmationDetailsSchema.parse({
      candidateName: "保存的候选人",
      probationSalary: 0,
    });
    const payload = await editedCard("completed", {
      baseSalary: 20_000,
      confirmationInfo: info,
      currency: "USD",
      interviewRecordId: "candidate-final",
    });
    expect(payload.text).toContain("offer审批已通过");
    expect(payload.text).toContain("试用薪资：0K");
    expect(payload.text).toContain("系统记录编码：candidate-final");
    expect(payload.text).not.toContain("待 SSC 确认");
  });

  it("explains a missing detail address for a long Offer without promising a missing copy button", async () => {
    const info = offerConfirmationDetailsSchema.parse({
      candidateName: "未配置详情地址的候选人",
      interviewFeedback: "详细".repeat(2500),
    });
    const payload = await editedCard("pending", {
      baseSalary: 15_000,
      confirmationInfo: info,
      currency: "CNY",
      interviewRecordId: "candidate-without-public-url",
    });
    expect(payload.text).toContain("未配置可用详情地址");
    expect(payload.text).toContain("系统中查看并复制全文");
    expect(payload.text).not.toContain("请打开“打开全文复制页”");
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(payload.reply_markup.inline_keyboard.flat().map((button) => button.text)).not.toContain(
      "打开全文复制页",
    );
  });

  it("keeps long Offer content available through candidate details instead of truncating it", async () => {
    const feedback = "详细".repeat(2500);
    const info = offerConfirmationDetailsSchema.parse({
      candidateName: "长内容候选人",
      interviewFeedback: feedback,
    });
    const payload = await editedCard(
      "pending",
      {
        baseSalary: 15_000,
        confirmationInfo: info,
        currency: "CNY",
        interviewRecordId: "candidate-long",
      },
      { detailUrl: "https://ats.example.test/offer-candidate/signed-long" },
    );
    expect(payload.text).toContain("信息较长");
    expect(payload.text).toContain("查看候选人详情");
    expect(payload.text).toContain("Offer 页签");
    expect(payload.text).not.toContain("详细".repeat(100));
    expect(payload.reply_markup.inline_keyboard.flat().some((button) => button.copy_text)).toBe(
      false,
    );
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({
        text: "查看候选人详情",
        url: "https://ats.example.test/offer-candidate/signed-long",
      }),
    );
    expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "接收确认" }),
    );
  });

  it("keeps punctuation-heavy Offer text available through candidate details before escaping exceeds the limit", async () => {
    const feedback = "*_[x](y).!".repeat(220);
    const info = offerConfirmationDetailsSchema.parse({
      candidateName: "Markdown 标点较多的候选人",
      interviewFeedback: feedback,
    });
    const payload = await editedCard(
      "pending",
      {
        baseSalary: 15_000,
        confirmationInfo: info,
        currency: "CNY",
        interviewRecordId: "candidate-escaped-long",
      },
      { detailUrl: "https://ats.example.test/offer-candidate/signed-escaped-long" },
    );
    expect(payload.text).toContain("信息较长");
    expect(payload.text).not.toContain(feedback.slice(0, 100));
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({
        text: "查看候选人详情",
        url: "https://ats.example.test/offer-candidate/signed-escaped-long",
      }),
    );
  });

  it("uses the complete-copy fallback before a punctuation-dense GFM autolink can truncate the Offer", async () => {
    const feedback = `https://example.test/${"_".repeat(1400)}a`;
    const info = offerConfirmationDetailsSchema.parse({ interviewFeedback: feedback });
    const payload = await editedCard(
      "pending",
      {
        baseSalary: 15_000,
        confirmationInfo: info,
        currency: "CNY",
        interviewRecordId: "candidate-autolink-long",
      },
      { detailUrl: "https://ats.example.test/offer-candidate/signed-autolink-long" },
    );
    expect(payload.text).toContain("信息较长");
    expect(payload.text).not.toContain("https://example");
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({
        text: "查看候选人详情",
        url: "https://ats.example.test/offer-candidate/signed-autolink-long",
      }),
    );
    expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "接收确认" }),
    );
  });

  it.each([
    ["pending", "接收确认", "osr"],
    ["confirming", "完成确认", "osc"],
  ] as const)(
    "renders the %s action as a usable inline callback button",
    async (status, label, actionId) => {
      const payload = await editedCard(status);
      const buttons = payload.reply_markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(status === "confirming" ? 2 : 1);
      const callback = buttons.find((button) => button.text === label)?.callback_data;
      expect(callback).toBeTypeOf("string");
      expect(callback).toContain(`"a":"${actionId}"`);
      expect(Buffer.byteLength(callback ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(callback).toContain(draftId.replaceAll("-", ""));
      if (status === "confirming") {
        expect(buttons).toContainEqual(
          expect.objectContaining({
            callback_data: expect.stringContaining('"a":"osd"'),
            text: "完成预入职时间确认",
          }),
        );
      }
    },
  );

  it("renders the broadcast second-confirmation buttons within Telegram's callback limit", async () => {
    const adapter = createOfferTelegramAdapter({
      botToken: "999999:fake-transport-test-token",
      mode: "webhook",
      secretToken: "fake-secret",
      userName: botUser.username,
    });
    const card = buildTelegramOfferCompletionCard(
      {
        canConfirm: true,
        canReceive: true,
        candidateName: "Candidate",
        draft: {
          id: draftId,
          position: "Role",
          sscConfirmationStatus: "confirming",
          sscRevision: 2_147_483_647,
          status: "draft",
          version: 3,
        },
        pipelineStage: "offer",
      },
      telegramOfferCallbackValue(draftId, 2_147_483_647),
      { persistent: true },
    );
    await adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card);
    const buttons = requests[0].reply_markup.inline_keyboard.flat();
    expect(buttons.map((button) => button.text)).toEqual([
      "完成预入职时间确认",
      "确认完成",
      "上传截图（选填）",
      "取消",
    ]);
    for (const button of buttons) {
      expect(Buffer.byteLength(button.callback_data ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(button.callback_data).toContain(draftId.replaceAll("-", ""));
    }
    expect(requests[0].text).not.toContain("30 分钟");
  });

  it.each([false, true])(
    "keeps full-copy access on the approval confirmation card (screenshot received: %s)",
    async (screenshotReceived) => {
      const adapter = createOfferTelegramAdapter({
        botToken: "999999:fake-transport-test-token",
        mode: "webhook",
        secretToken: "fake-transport-test-secret",
        userName: botUser.username,
      });
      const info = offerConfirmationDetailsSchema.parse({
        candidateName: "审批确认候选人",
        hiringUnitName: "研发中心",
        interviewFeedback: "内部审批参考说明。".repeat(10),
        probationPeriod: "2个月",
        probationSalary: 10_000,
      });
      const expected = buildOfferConfirmationText({
        baseSalary: 15_000,
        candidateRecordId: "confirmation-candidate",
        currency: "CNY",
        info,
        interviewRounds: completedInterviewRounds,
        position: "工程师",
        sscConfirmationStatus: "confirming",
      });
      expect(expected.length).toBeGreaterThan(256);
      const card = buildTelegramOfferCompletionCard(
        {
          canConfirm: true,
          canReceive: true,
          candidateName: "审批确认候选人",
          draft: {
            baseSalary: 15_000,
            confirmationInfo: info,
            currency: "CNY",
            id: draftId,
            interviewRecordId: "confirmation-candidate",
            position: "工程师",
            sscConfirmationStatus: "confirming",
            sscRevision: 1,
            status: "draft",
            version: 3,
          },
          interviewRounds: completedInterviewRounds,
          pipelineStage: "offer",
        },
        "a".repeat(32),
        { detailUrl: "https://ats.example.test/offer-candidate/confirmation", screenshotReceived },
      );
      await adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card);
      const buttons = requests[0].reply_markup.inline_keyboard.flat();
      const copies = buttons.filter((button) => button.copy_text);
      expect(copies).toEqual([]);
      expect(expected).toContain("能清楚说明方案与取舍，建议录用。");
      expect(expected).toContain("10:30");
      expect(buttons).toContainEqual(
        expect.objectContaining({
          callback_data: expect.stringContaining('"a":"osf"'),
          text: "确认完成",
        }),
      );
      expect(buttons).toContainEqual(
        expect.objectContaining({
          text: "查看候选人详情",
          url: "https://ats.example.test/offer-candidate/confirmation",
        }),
      );
      expect(buttons.map((button) => button.text)).not.toContain("打开全文复制页");
      expect(buttons.filter((button) => button.url)).toHaveLength(1);
      expect(copiedBlock(requests[0])).toBe(expected);
    },
  );

  it("explicitly clears the old inline keyboard when SSC confirmation completes", async () => {
    const payload = await editedCard("completed");
    expect(payload.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("shows a complete final button after screenshot upload and clears actions from the old prompt", async () => {
    const adapter = createOfferTelegramAdapter({
      botToken: "999999:fake-transport-test-token",
      mode: "webhook",
      secretToken: "fake-transport-test-secret",
      userName: botUser.username,
    });
    const card = buildTelegramOfferCompletionCard(
      {
        canConfirm: true,
        canReceive: true,
        candidateName: "Transport test candidate",
        draft: {
          id: draftId,
          position: "Transport test role",
          sscConfirmationStatus: "confirming",
          sscRevision: 1,
          status: "draft",
          version: 3,
        },
        pipelineStage: "offer",
      },
      "a".repeat(32),
      { screenshotReceived: true },
    );
    await adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card);
    expect(requests[0].text).toContain("截图已收到");
    const [primary] = requests[0].reply_markup.inline_keyboard;
    expect(primary).toHaveLength(1);
    expect(primary[0].text).toBe("确认完成");
    expect(primary[0].callback_data).toContain('"a":"osf"');
    expect(Buffer.byteLength(primary[0].callback_data ?? "", "utf-8")).toBeLessThanOrEqual(64);
    await adapter.editMessage(
      `telegram:${chatId}`,
      `${chatId}:${messageId}`,
      "审批截图已收到，请使用下方最新确认卡片。",
    );
    expect(requests[1].reply_markup.inline_keyboard).toEqual([]);
  });
});
