import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ChatSdk from "chat";
import { getTelegramBot, shutdownTelegramBot } from "./bot";
import { OfferDraftError } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";

const mocks = vi.hoisted(() => ({
  actions: new Map<string, (event: unknown) => Promise<void>>(),
  bind: vi.fn(),
  complete: vi.fn(),
  context: vi.fn(),
  receive: vi.fn(),
  slash: new Map<string, (event: unknown) => Promise<void>>(),
  users: vi.fn(),
}));

vi.mock("../dao", () => ({ bindTelegramUser: mocks.bind }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { query: { user: { findMany: mocks.users } } },
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts",
  () => ({
    OfferDraftError: class extends Error {
      readonly status: number;
      constructor(errorMessage: string, status: number) {
        super(errorMessage);
        this.status = status;
      }
    },
    completeOfferSscConfirmation: mocks.complete,
    loadAuthorizedOfferSscContext: mocks.context,
    receiveOfferSscConfirmation: mocks.receive,
  }),
);
vi.mock("@chat-adapter/state-pg", () => ({ createPostgresState: vi.fn() }));
vi.mock("@chat-adapter/telegram", () => ({ createTelegramAdapter: vi.fn() }));
vi.mock("chat", async (importOriginal) => ({
  ...(await importOriginal<typeof ChatSdk>()),
  Chat: function MockChat() {
    return {
      onAction(ids: string | string[], handler: (event: unknown) => Promise<void>) {
        for (const id of Array.isArray(ids) ? ids : [ids]) {
          mocks.actions.set(id, handler);
        }
      },
      onDirectMessage: vi.fn(),
      onSlashCommand(commandName: string, handler: (event: unknown) => Promise<void>) {
        mocks.slash.set(commandName, handler);
      },
      shutdown: vi.fn(),
    };
  },
}));

const draftId = "550e8400-e29b-41d4-a716-446655440000";
const callbackDraftId = "550e8400e29b41d4a716446655440000";
const draft = {
  id: draftId,
  interviewRecordId: "candidate-a",
  organizationId: "org-a",
  position: "后端工程师",
  sscConfirmationStatus: "pending",
  sscReceivedBy: null,
  sscRevision: 3,
  status: "draft",
  version: 2,
};
const boundUser = {
  banned: false,
  id: "user-a",
  telegram: "@SscAlice",
  telegramBoundUsername: "sscalice",
  telegramChatId: "12345",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actions.clear();
  mocks.slash.clear();
  mocks.users.mockResolvedValue([boundUser]);
  mocks.bind.mockResolvedValue({ kind: "registered", memberAmbiguous: false });
  mocks.context.mockResolvedValue({
    actorRole: "ssc-reviewer",
    canConfirm: true,
    canReceive: true,
    candidateName: "候选人甲",
    draft,
    pipelineStage: "offer",
  });
  mocks.receive.mockResolvedValue({ ...draft, sscConfirmationStatus: "confirming" });
  mocks.complete.mockResolvedValue({ ...draft, sscConfirmationStatus: "completed" });
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
  getTelegramBot();
});

afterEach(async () => {
  await shutdownTelegramBot();
  vi.unstubAllEnvs();
});

function message(text: string, overrides: Record<string, unknown> = {}) {
  const post = vi.fn(() => Promise.resolve());
  return {
    channel: { post },
    post,
    raw: {
      chat: { id: 12_345, type: "private" },
      from: { id: 12_345, username: "SscAlice" },
      ...overrides,
    },
    text,
  };
}

async function command(name: string, event: ReturnType<typeof message>) {
  const handler = mocks.slash.get(name);
  expect(handler, `${name} handler`).toBeTypeOf("function");
  await handler?.(event);
  return event.post;
}

async function action(id: string, value: string, overrides: Record<string, unknown> = {}) {
  const post = vi.fn(() => Promise.resolve());
  const handler = mocks.actions.get(id);
  expect(handler, `${id} action handler`).toBeTypeOf("function");
  await handler?.({
    actionId: id,
    raw: {
      data: "ignored",
      from: { id: 12_345, username: "SscAlice" },
      id: "callback-a",
      message: { chat: { id: 12_345, type: "private" }, message_id: 7 },
      ...overrides,
    },
    thread: { post },
    user: { userId: "forged-system-user" },
    value,
  });
  return post;
}

describe("self-service Telegram Offer SSC actions", () => {
  it("opens an Offer deep link without implicitly rebinding the sender", async () => {
    const post = await command("/start", message(`offer_${draftId}`));
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).toContain("候选人甲");
    expect(JSON.stringify(post.mock.calls)).toContain("Offer新增");
  });

  it("checks the actual Telegram sender rather than a supplied system user", async () => {
    await action("osr", `${callbackDraftId}:3`);
    expect(mocks.users).toHaveBeenCalledWith(
      expect.objectContaining({ where: { telegramChatId: "12345" } }),
    );
    expect(mocks.receive).toHaveBeenCalledWith({
      actor: { id: "user-a", role: "ssc-reviewer" },
      draftId,
      interviewRecordId: "candidate-a",
      organizationId: "org-a",
      revision: 3,
      source: "telegram",
    });
  });

  it.each([
    ["unbound", []],
    [
      "numeric profile without verified binding",
      [{ ...boundUser, telegram: "12345", telegramBoundUsername: null }],
    ],
    ["changed username", [{ ...boundUser, telegramBoundUsername: "oldhandle" }]],
    ["banned", [{ ...boundUser, banned: true }]],
    ["ambiguous binding", [boundUser, { ...boundUser, id: "user-b" }]],
  ])("denies %s identity before loading any Offer details", async (_name, users) => {
    mocks.users.mockResolvedValue(users);
    const post = await command("/offer", message(draftId));
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).not.toContain("候选人甲");
    expect(post).toHaveBeenCalledWith(expect.stringContaining("绑定"));
  });

  it("rejects a group callback before any identity or business query", async () => {
    await action("osr", `${callbackDraftId}:3`, {
      message: { chat: { id: -100_123, type: "supergroup" }, message_id: 7 },
    });
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("rejects callbacks where the sender is not the private chat owner", async () => {
    await action("osr", `${callbackDraftId}:3`, { from: { id: 999, username: "SscAlice" } });
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("does not invoke a transition when current workspace authorization denies access", async () => {
    mocks.context.mockRejectedValue(new OfferDraftError("无权访问此 Offer。", 404));
    const post = await action("osr", `${callbackDraftId}:3`);
    expect(mocks.receive).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).not.toContain("候选人甲");
  });

  it("preserves the clicked revision so an old card cannot approve a newer Offer", async () => {
    mocks.receive.mockRejectedValue(new OfferDraftError("Offer 已更新，请重新打开。", 400));
    const post = await action("osr", `${callbackDraftId}:2`);
    expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
    expect(post).toHaveBeenCalledWith(expect.stringContaining("已更新"));
  });

  it("uses the shared completion action and renders its committed state", async () => {
    const post = await action("osc", `${callbackDraftId}:3`);
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3, source: "telegram" }),
    );
    expect(JSON.stringify(post.mock.calls)).toContain("已完成确认");
    expect(JSON.stringify(post.mock.calls)).not.toContain('"id":"osc"');
  });

  it.each([
    `${callbackDraftId}:0`,
    `${callbackDraftId}:-1`,
    `${callbackDraftId}:3!`,
    "not-an-offer:3",
  ])("rejects malformed callback value %s before querying", async (value) => {
    await action("osc", value);
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("keeps callback payloads within Telegram's 64-byte limit at the database revision limit", async () => {
    mocks.context.mockResolvedValue({
      actorRole: "ssc-reviewer",
      canConfirm: true,
      canReceive: true,
      candidateName: "候选人甲",
      draft: { ...draft, sscRevision: 2_147_483_647 },
      pipelineStage: "offer",
    });
    const post = await command("/offer", message(draftId));
    const cardText = JSON.stringify(post.mock.calls);
    expect(cardText).toContain(`${callbackDraftId}:zik0zj`);
    expect(
      Buffer.byteLength(`chat:{"a":"osr","v":"${callbackDraftId}:zik0zj"}`, "utf-8"),
    ).toBeLessThanOrEqual(64);
    await action("osr", `${callbackDraftId}:zik0zj`);
    expect(mocks.receive).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2_147_483_647 }),
    );
  });

  it.each([
    ["pending", "osr"],
    ["confirming", "osc"],
  ])("does not offer a %s action to a read-only member", async (status, actionId) => {
    mocks.context.mockResolvedValue({
      actorRole: "offer-reader",
      canConfirm: false,
      canReceive: false,
      candidateName: "候选人甲",
      draft: { ...draft, sscConfirmationStatus: status },
      pipelineStage: "offer",
    });
    const post = await command("/offer", message(draftId));
    expect(JSON.stringify(post.mock.calls)).toContain("候选人甲");
    expect(JSON.stringify(post.mock.calls)).not.toContain(`"id":"${actionId}"`);
  });

  it.each([
    ["superseded", "offer"],
    ["sent", "offer"],
    ["draft", "closed"],
  ])("shows %s/%s Offer history without active buttons", async (status, pipelineStage) => {
    mocks.context.mockResolvedValue({
      actorRole: "ssc-reviewer",
      canConfirm: true,
      canReceive: true,
      candidateName: "候选人甲",
      draft: { ...draft, status },
      pipelineStage,
    });
    const post = await command("/offer", message(draftId));
    expect(JSON.stringify(post.mock.calls)).toContain("候选人甲");
    expect(JSON.stringify(post.mock.calls)).not.toContain('"id":"osr"');
  });
});
