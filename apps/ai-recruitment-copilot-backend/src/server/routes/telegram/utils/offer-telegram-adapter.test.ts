import { Actions, Button, Card, CardText, LinkButton } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfferTelegramAdapter } from "./offer-telegram-adapter";

interface RequestPayload {
  chat_id: string | number;
  message_id?: number;
  parse_mode?: string;
  reply_markup?: {
    inline_keyboard: {
      callback_data?: string;
      copy_text?: { text: string };
      text: string;
      url?: string;
    }[][];
  };
  text?: string;
}

const requests: { method: string; payload: RequestPayload }[] = [];
const chatId = "12345";
const botUser = {
  first_name: "Copy test bot",
  id: 999_999,
  is_bot: true,
  username: "copy_test_bot",
};

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = url.pathname.split("/").at(-1) ?? "";
      if (method === "getMe") {
        return Response.json({ ok: true, result: botUser });
      }
      if (
        !["sendMessage", "sendRichMessage", "editMessageText"].includes(method) ||
        typeof init?.body !== "string"
      ) {
        throw new Error("Unexpected Telegram call in isolated native copy test");
      }
      const payload = JSON.parse(init.body) as RequestPayload;
      requests.push({ method, payload });
      await Promise.resolve();
      return Response.json({
        ok: true,
        result: {
          chat: { first_name: "SSC user", id: Number(payload.chat_id), type: "private" },
          date: 1_700_000_000,
          from: botUser,
          message_id: payload.message_id ?? requests.length + 10,
          reply_markup: payload.reply_markup,
          text: payload.text ?? "Offer card",
        },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function adapter() {
  return createOfferTelegramAdapter({
    botToken: "999999:fake-native-copy-test-token",
    mode: "webhook",
    secretToken: "fake-native-copy-secret",
    userName: botUser.username,
  });
}

function card(text?: string) {
  const value = Card({
    children: [
      CardText("Offer information"),
      Actions([
        Button({ id: "osr", label: "接收确认", value: "draft:1" }),
        LinkButton({
          label: "查看候选人详情",
          url: "https://ats.example.test/offer-candidate/signed",
        }),
      ]),
      Actions([
        LinkButton({
          label: "打开全文复制页",
          url: "https://ats.example.test/offer-candidate/signed#offer-confirmation-info",
        }),
      ]),
    ],
    title: "Offer",
  });
  return text === undefined ? value : { ...value, telegramOfferCopyText: text };
}

function copyButtons(payload: RequestPayload) {
  return payload.reply_markup?.inline_keyboard.flat().filter((button) => button.copy_text) ?? [];
}

describe("SSC native copy Telegram transport", () => {
  it.each(["post", "edit"] as const)(
    "puts a true clipboard button in the original %s request",
    async (operation) => {
      const text = "【offer信息】\n简历名：甲\n薪资：15K\n保留 `*_[]\\ 特殊字符";
      const target = adapter();
      await (operation === "post"
        ? target.postMessage(`telegram:${chatId}`, card(text))
        : target.editMessage(`telegram:${chatId}`, `${chatId}:7`, card(text)));
      expect(requests).toHaveLength(1);
      const [{ payload }] = requests;
      expect(copyButtons(payload)).toEqual([{ copy_text: { text }, text: "复制 Offer 信息" }]);
      expect(payload.reply_markup?.inline_keyboard.flat()).toContainEqual(
        expect.objectContaining({ callback_data: expect.any(String), text: "接收确认" }),
      );
      expect(payload.reply_markup?.inline_keyboard.flat()).toContainEqual({
        text: "打开全文复制页",
        url: "https://ats.example.test/offer-candidate/signed#offer-confirmation-info",
      });
    },
  );

  it("copies all long text with numbered native segments, without URLs or callbacks", async () => {
    const text = `【offer信息】\n${"保留薪资与换行😀\n".repeat(50)}结尾`;
    await adapter().postMessage(`telegram:${chatId}`, card(text));
    const buttons = copyButtons(requests[0].payload);
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.map((button) => button.copy_text?.text).join("")).toBe(text);
    for (const [index, button] of buttons.entries()) {
      expect(button.text).toBe(`复制第 ${index + 1}/${buttons.length} 段`);
      expect(button.copy_text?.text.length).toBeLessThanOrEqual(256);
      expect(button).not.toHaveProperty("url");
      expect(button).not.toHaveProperty("callback_data");
    }
  });

  it("preserves one native copy group and the receive callback when Markdown falls back to plain text", async () => {
    const text = `【offer信息】\n${"薪资：15K，保留 `*_[]\\\n".repeat(25)}结尾`;
    const defaultFetch = vi.mocked(fetch).getMockImplementation();
    if (!defaultFetch) {
      throw new Error("Missing isolated Telegram fetch implementation");
    }
    let rejectedMarkdown = false;
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        !rejectedMarkdown &&
        url.pathname.endsWith("/editMessageText") &&
        typeof init?.body === "string"
      ) {
        const payload = JSON.parse(init.body) as RequestPayload;
        requests.push({ method: "editMessageText", payload });
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
      return defaultFetch(input, init);
    });

    await adapter().editMessage(`telegram:${chatId}`, `${chatId}:7`, card(text));

    expect(requests.map((request) => request.method)).toEqual([
      "editMessageText",
      "editMessageText",
    ]);
    expect(requests[0].payload.parse_mode).toBe("MarkdownV2");
    expect(requests[1].payload.parse_mode).toBeUndefined();
    const originalCopies = copyButtons(requests[0].payload);
    expect(originalCopies.length).toBeGreaterThan(1);
    expect(copyButtons(requests[1].payload)).toEqual(originalCopies);
    for (const { payload } of requests) {
      expect(
        copyButtons(payload)
          .map((button) => button.copy_text?.text)
          .join(""),
      ).toBe(text);
      expect(
        payload.reply_markup?.inline_keyboard.flat().filter((button) => button.callback_data),
      ).toEqual([expect.objectContaining({ callback_data: expect.any(String), text: "接收确认" })]);
    }
  });

  it("reads SSC metadata from the SDK card wrapper", async () => {
    const text = "包装中的 Offer 文本";
    await adapter().postMessage(`telegram:${chatId}`, { card: card(text) });
    expect(copyButtons(requests[0].payload)[0]?.copy_text?.text).toBe(text);
  });

  it("passes ordinary cards through without manufacturing clipboard data", async () => {
    await adapter().postMessage(`telegram:${chatId}`, card());
    expect(copyButtons(requests[0].payload)).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("keeps concurrent SSC copies isolated and clears scope before ordinary messages", async () => {
    const target = adapter();
    await Promise.all([
      target.postMessage("telegram:12345", card("Offer A")),
      target.postMessage("telegram:67890", card("Offer B")),
    ]);
    const first = requests.find((request) => String(request.payload.chat_id) === "12345");
    const second = requests.find((request) => String(request.payload.chat_id) === "67890");
    expect(first && copyButtons(first.payload)[0]?.copy_text?.text).toBe("Offer A");
    expect(second && copyButtons(second.payload)[0]?.copy_text?.text).toBe("Offer B");
    await target.postMessage("telegram:99999", "关注成功");
    expect(requests.at(-1)?.payload.reply_markup).toBeUndefined();
    expect(requests).toHaveLength(3);
  });

  it("does not expose an incomplete subset when the Offer requires more than eight parts", async () => {
    await adapter().editMessage(`telegram:${chatId}`, `${chatId}:7`, card("甲".repeat(2049)));
    expect(copyButtons(requests[0].payload)).toEqual([]);
    expect(requests[0].payload.reply_markup?.inline_keyboard.flat()).toContainEqual(
      expect.objectContaining({ text: "打开全文复制页" }),
    );
  });
});
