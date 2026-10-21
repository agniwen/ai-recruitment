import { createTelegramAdapter } from "@chat-adapter/telegram";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTelegramOfferCard,
  buildTelegramOfferCompletionCard,
  telegramOfferCallbackValue,
} from "./offer-ssc-card";

interface EditRequest {
  chat_id: string | number;
  message_id: number;
  reply_markup: {
    inline_keyboard: { callback_data?: string; text: string }[][];
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

async function editedCard(status: "pending" | "confirming" | "completed") {
  const adapter = createTelegramAdapter({
    botToken: "999999:fake-transport-test-token",
    mode: "webhook",
    secretToken: "fake-transport-test-secret",
    userName: botUser.username,
  });
  const card = buildTelegramOfferCard({
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
    },
    pipelineStage: "offer",
  });
  await adapter.editMessage(`telegram:${chatId}`, `${chatId}:${messageId}`, card);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ chat_id: chatId, message_id: messageId });
  return requests[0];
}

describe("Offer SSC cards through the real Telegram adapter", () => {
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
