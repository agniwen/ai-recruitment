import { createTelegramAdapter } from "@chat-adapter/telegram";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { buildOfferConfirmationText } from "@arc/shared/offer-confirmation";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
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
    inline_keyboard: { callback_data?: string; text: string; url?: string }[][];
  };
  text?: string;
}

const requests: EditRequest[] = [];
const chatId = "12345";
const messageId = 7;
const draftId = "550e8400-e29b-41d4-a716-446655440000";
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
      if (method !== "editMessageText" || typeof init?.body !== "string") {
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
            message_id: payload.message_id,
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
) {
  const adapter = createTelegramAdapter({
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
      pipelineStage: "offer",
    },
    options,
  );
  await adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ chat_id: chatId, message_id: messageId });
  return requests[0];
}

describe("Offer SSC cards through the real Telegram adapter", () => {
  it("renders the complete Offer snapshot as one safely escaped copyable code block", async () => {
    const info = offerConfirmationDetailsSchema.parse({
      candidateCode: "SSC-001",
      candidateName: "候选人<甲>&乙",
      departmentName: "研发中心",
      directManager: "负责人 `甲` 与 \\测试",
      hiringUnitName: "技术组织",
      interviewFeedback: "审阅记录\n```\n仍应保持在完整复制块里\n```\n结束",
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
    const escaped = expected.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
    expect(payload.text).toContain(`\`\`\`\n${escaped}\n\`\`\``);
    expect(payload.reply_markup.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callback_data: expect.stringContaining('"a":"osr"'),
          text: "接收确认",
        }),
        expect.objectContaining({
          text: "复制完整 Offer 信息",
          url: "https://ats.example.test/offer-candidate/signed-offer#offer-confirmation-info",
        }),
      ]),
    );
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
    expect(payload.text).not.toContain("请打开“复制完整 Offer 信息”");
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(payload.reply_markup.inline_keyboard.flat().map((button) => button.text)).not.toContain(
      "复制完整 Offer 信息",
    );
  });

  it("keeps long Offer content available through the signed copy page instead of truncating it", async () => {
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
    expect(payload.text).not.toContain("详细".repeat(100));
    expect(payload.text?.length).toBeLessThanOrEqual(4096);
    expect(payload.reply_markup.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({
        text: "复制完整 Offer 信息",
        url: "https://ats.example.test/offer-candidate/signed-long#offer-confirmation-info",
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
      expect(buttons).toHaveLength(1);
      expect(buttons[0].text).toBe(label);
      const callback = buttons[0].callback_data;
      expect(callback).toBeTypeOf("string");
      expect(callback).toContain(`"a":"${actionId}"`);
      expect(Buffer.byteLength(callback ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(callback).toContain(draftId.replaceAll("-", ""));
    },
  );

  it("renders the broadcast second-confirmation buttons within Telegram's callback limit", async () => {
    const adapter = createTelegramAdapter({
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
    expect(buttons.map((button) => button.text)).toEqual(["确认完成", "上传截图（选填）", "取消"]);
    for (const button of buttons) {
      expect(Buffer.byteLength(button.callback_data ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(button.callback_data).toContain(draftId.replaceAll("-", ""));
    }
    expect(requests[0].text).not.toContain("30 分钟");
  });

  it("explicitly clears the old inline keyboard when SSC confirmation completes", async () => {
    const payload = await editedCard("completed");
    expect(payload.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("shows a complete final button after screenshot upload and clears actions from the old prompt", async () => {
    const adapter = createTelegramAdapter({
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
