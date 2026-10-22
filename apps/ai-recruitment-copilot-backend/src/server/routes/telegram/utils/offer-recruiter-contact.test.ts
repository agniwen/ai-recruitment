import { parseMarkdown } from "chat";
import type { ActionEvent, Message } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTelegramOfferRecruiterCard,
  handleTelegramOfferRecruiterAction,
  handleTelegramOfferRecruiterMessage,
} from "./offer-recruiter-contact";
import { withTelegramOfferCompletionState } from "./offer-ssc-state";

const mocks = vi.hoisted(() => ({ load: vi.fn(), prompt: vi.fn(), submit: vi.fn() }));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-recruiter-contact",
  () => ({
    loadTelegramOfferRecruiterContactContext: mocks.load,
    submitOfferRecruiterContact: mocks.submit,
  }),
);
vi.mock("./offer-recruiter-prompt", () => ({ postTelegramOfferRecruiterPrompt: mocks.prompt }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    transaction: (run: (tx: { execute: () => Promise<void> }) => unknown) =>
      run({ execute: () => Promise.resolve() }),
  },
}));

const draftId = "321abcde-1234-4123-8123-123456789abc";
const value = "321abcde123441238123123456789abc:2";
const context = {
  canConfirm: true,
  candidateName: "候选人甲",
  candidatePrivateTelegram: null,
  draftId,
  interviewRecordId: "candidate-a",
  notificationIssue: null,
  organizationId: "workspace-a",
  position: "设计师",
  recruiterName: "招聘甲",
  revision: 2,
  status: "pending" as const,
  version: 3,
};

type ContactThread = Parameters<typeof handleTelegramOfferRecruiterMessage>[0];

function fakeThread() {
  let stored: Record<string, unknown> = { offerSscCompletions: { untouched: true } };
  let next = 100;
  const post = vi.fn((_card: unknown) => {
    next += 1;
    return Promise.resolve({ id: `12345:${next}` });
  });
  const thread = {
    id: "telegram:12345",
    post,
    setState(state: Record<string, unknown>) {
      stored = state;
      return Promise.resolve();
    },
    get state() {
      return Promise.resolve(stored);
    },
  } satisfies Pick<ContactThread, "id" | "state" | "setState"> & { post: typeof post };
  // Tests exercise only these thread boundaries; SDK lifecycle methods remain SDK-owned.
  return thread as unknown as ContactThread & typeof thread;
}
type TestThread = ReturnType<typeof fakeThread>;
function action(thread: TestThread, actionId: string, callbackValue: string, messageId = 10) {
  return {
    actionId,
    adapter: { editMessage: vi.fn(() => Promise.resolve()) },
    messageId: `12345:${messageId}`,
    raw: {
      from: { id: 12_345, username: "Recruiter_A" },
      message: { chat: { id: 12_345, type: "private" }, message_id: messageId },
    },
    thread,
    threadId: thread.id,
    value: callbackValue,
  } as unknown as ActionEvent;
}
function textMessage(text: string, replyId?: number, changes: Record<string, unknown> = {}) {
  return {
    metadata: {},
    raw: {
      chat: { id: 12_345, type: "private" },
      from: { id: 12_345, username: "Recruiter_A" },
      message_id: 50,
      text,
      ...(replyId ? { reply_to_message: { message_id: replyId } } : {}),
      ...changes,
    },
    replyTo: replyId ? { id: `12345:${replyId}` } : undefined,
    text,
  } as unknown as Message;
}
function button(tree: unknown, id: string): string | undefined {
  if (!tree || typeof tree !== "object") {
    return;
  }
  const node = tree as Record<string, unknown>;
  if (node.id === id && typeof node.value === "string") {
    return node.value;
  }
  for (const child of Object.values(node)) {
    const found = button(child, id);
    if (found) {
      return found;
    }
  }
}
function renderedStrings(content: unknown): string {
  if (typeof content === "string") {
    return JSON.stringify(parseMarkdown(content));
  }
  return content && typeof content === "object"
    ? Object.values(content).map(renderedStrings).join("\n")
    : "";
}
async function begin(thread: TestThread) {
  await handleTelegramOfferRecruiterAction(action(thread, "orc", value));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(context);
  mocks.submit.mockImplementation((input) =>
    Promise.resolve({
      ...context,
      canConfirm: false,
      candidatePrivateTelegram: input.candidatePrivateTelegram,
      status: "completed",
    }),
  );
  mocks.prompt.mockResolvedValue("12345:90");
});
afterEach(() => vi.useRealTimers());

describe("Offer recruiter private Telegram collection", () => {
  it("keeps SSC submission unavailable until a private Telegram exists", () => {
    const card = buildTelegramOfferRecruiterCard(context);
    expect(JSON.stringify(card)).toContain("候选人甲");
    expect(button(card, "orc")).toBe(value);
    expect(button(card, "ors")).toBeUndefined();
    expect(button(card, "osr")).toBeUndefined();
  });

  it("lets the recruiter explicitly confirm an existing Telegram without retyping it", async () => {
    const existing = { ...context, candidatePrivateTelegram: "@candidate_a" };
    const card = buildTelegramOfferRecruiterCard(existing);
    expect(button(card, "ors")).toBe(value);
    mocks.load.mockResolvedValue(existing);
    const thread = fakeThread();
    await handleTelegramOfferRecruiterAction(action(thread, "ors", value));
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        candidatePrivateTelegram: "@candidate_a",
        draftId,
        revision: 2,
        source: "telegram",
        telegramActor: { telegramUserId: "12345", username: "Recruiter_A" },
      }),
    );
    expect(JSON.stringify(thread.post.mock.calls)).toContain("已提交 SSC");
  });

  it("closes an earlier input prompt after confirming the existing Telegram", async () => {
    mocks.load.mockResolvedValue({ ...context, candidatePrivateTelegram: "@candidate_a" });
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterAction(action(thread, "ors", value));
    expect(await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_b"))).toBe(
      false,
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("opens a private reply prompt without overwriting SSC completion state", async () => {
    const thread = fakeThread();
    await begin(thread);
    expect(mocks.prompt).toHaveBeenCalledWith(thread, expect.stringContaining("候选人甲"));
    const state = await thread.state;
    expect(state.offerSscCompletions).toEqual({ untouched: true });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("preserves both workflows when SSC writes its completion session after a contact prompt", async () => {
    const thread = fakeThread();
    await begin(thread);
    await withTelegramOfferCompletionState(thread, "12345", (pending) => {
      pending["f".repeat(32)] = {
        chatId: "12345",
        draftId,
        expiresAt: Date.now() + 60_000,
        interviewRecordId: "candidate-a",
        organizationId: "workspace-a",
        promptMessageId: 70,
        revision: 2,
        status: "pending",
      };
    });
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 90));
    expect(button(thread.post.mock.calls, "ors")).toMatch(/^[0-9a-f]{32}$/u);
    const state = await thread.state;
    expect(state.offerSscCompletions).toHaveProperty("f".repeat(32));
  });

  it("previews a normalized Telegram and requires a separate confirmation click", async () => {
    const thread = fakeThread();
    await begin(thread);
    expect(
      await handleTelegramOfferRecruiterMessage(
        thread,
        textMessage("https://t.me/Candidate_One", 90),
      ),
    ).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
    const confirm = button(thread.post.mock.calls, "ors");
    expect(confirm).toMatch(/^[0-9a-f]{32}$/u);
    expect(renderedStrings(thread.post.mock.calls)).toContain("@Candidate_One");
    await handleTelegramOfferRecruiterAction(action(thread, "ors", confirm ?? "", 101));
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        candidatePrivateTelegram: "@Candidate_One",
        interviewRecordId: "candidate-a",
        organizationId: "workspace-a",
        revision: 2,
      }),
    );
    await handleTelegramOfferRecruiterAction(action(thread, "ors", confirm ?? "", 101));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("ignores ordinary chat and screenshot uploads without an active contact prompt", async () => {
    const thread = fakeThread();
    expect(await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a"))).toBe(
      false,
    );
    await begin(thread);
    expect(
      await handleTelegramOfferRecruiterMessage(
        thread,
        textMessage("", 90, { photo: [{ file_id: "image" }], text: undefined }),
      ),
    ).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("marks both the original Offer card and the review card as submitted", async () => {
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 90));
    const confirm = button(thread.post.mock.calls, "ors");
    const event = action(thread, "ors", confirm ?? "", 101);
    await handleTelegramOfferRecruiterAction(event);
    const editedIds = vi.mocked(event.adapter.editMessage).mock.calls.map(([, id]) => id);
    expect(editedIds).toEqual(expect.arrayContaining(["12345:10", "12345:101"]));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("retains the original card when reopening private Telegram input from a review", async () => {
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 90));
    mocks.prompt.mockResolvedValue("12345:91");
    await handleTelegramOfferRecruiterAction(action(thread, "orc", value, 101));
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_b", 91));
    const confirm = button(thread.post.mock.calls.at(-1), "ors");
    const event = action(thread, "ors", confirm ?? "", 102);
    await handleTelegramOfferRecruiterAction(event);
    const editedIds = vi.mocked(event.adapter.editMessage).mock.calls.map(([, id]) => id);
    expect(editedIds).toEqual(expect.arrayContaining(["12345:10", "12345:102"]));
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ candidatePrivateTelegram: "@candidate_b" }),
    );
  });

  it("refreshes an authorized old card after the system already submitted its current revision", async () => {
    mocks.load.mockResolvedValue({
      ...context,
      canConfirm: false,
      candidatePrivateTelegram: "@candidate_a",
      status: "completed",
    });
    const thread = fakeThread();
    const event = action(thread, "orc", value);
    await handleTelegramOfferRecruiterAction(event);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(event.adapter.editMessage).toHaveBeenCalledWith(
      thread.id,
      "12345:10",
      expect.objectContaining({ type: "card" }),
    );
    expect(JSON.stringify(thread.post.mock.calls)).toContain("已提交 SSC");
    expect(JSON.stringify(thread.post.mock.calls)).not.toContain("当前无法确认");
  });

  it("refreshes both cards without resubmitting when the system completed a pending review", async () => {
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 90));
    const confirm = button(thread.post.mock.calls, "ors");
    mocks.load.mockResolvedValue({
      ...context,
      canConfirm: false,
      candidatePrivateTelegram: "@candidate_b",
      status: "completed",
    });
    const event = action(thread, "ors", confirm ?? "", 101);
    await handleTelegramOfferRecruiterAction(event);
    expect(mocks.submit).not.toHaveBeenCalled();
    const editedIds = vi.mocked(event.adapter.editMessage).mock.calls.map(([, id]) => id);
    expect(editedIds).toEqual(expect.arrayContaining(["12345:10", "12345:101"]));
    expect(renderedStrings(vi.mocked(event.adapter.editMessage).mock.calls)).toContain(
      "@candidate_b",
    );
  });

  it("rejects an invalid handle and keeps the prompt available for a correction", async () => {
    const thread = fakeThread();
    await begin(thread);
    expect(
      await handleTelegramOfferRecruiterMessage(thread, textMessage("候选人还没给我TG", 90)),
    ).toBe(true);
    expect(button(thread.post.mock.calls, "ors")).toBeUndefined();
    await handleTelegramOfferRecruiterMessage(thread, textMessage("candidate_a", 90));
    expect(button(thread.post.mock.calls, "ors")).toMatch(/^[0-9a-f]{32}$/u);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not attach a reply to a different prompt", async () => {
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 91));
    expect(button(thread.post.mock.calls, "ors")).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("accepts a direct handle only when exactly one contact prompt is active", async () => {
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a"));
    expect(button(thread.post.mock.calls, "ors")).toMatch(/^[0-9a-f]{32}$/u);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous direct handle when two candidate prompts are active", async () => {
    const thread = fakeThread();
    await begin(thread);
    mocks.load.mockResolvedValue({
      ...context,
      candidateName: "候选人乙",
      draftId: "421abcde-1234-4123-8123-123456789abc",
    });
    mocks.prompt.mockResolvedValue("12345:91");
    await handleTelegramOfferRecruiterAction(
      action(thread, "orc", "421abcde123441238123123456789abc:2"),
    );
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a"));
    expect(button(thread.post.mock.calls, "ors")).toBeUndefined();
    expect(JSON.stringify(thread.post.mock.calls)).toContain("回复");
  });

  it.each(["pending", "completed"] as const)(
    "rejects a superseded %s revision before opening a prompt",
    async (status) => {
      mocks.load.mockResolvedValue({ ...context, revision: 3, status });
      const thread = fakeThread();
      await begin(thread);
      expect(mocks.prompt).not.toHaveBeenCalled();
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(JSON.stringify(thread.post.mock.calls)).toContain("更新");
    },
  );

  it("rechecks permissions after the recruiter has typed a Telegram", async () => {
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 90));
    const confirm = button(thread.post.mock.calls, "ors");
    mocks.load.mockResolvedValue({ ...context, canConfirm: false });
    await handleTelegramOfferRecruiterAction(action(thread, "ors", confirm ?? "", 101));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("expires an unfinished prompt and never submits a stale confirmation", async () => {
    vi.useFakeTimers();
    const thread = fakeThread();
    await begin(thread);
    await handleTelegramOfferRecruiterMessage(thread, textMessage("@candidate_a", 90));
    const confirm = button(thread.post.mock.calls, "ors");
    vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
    await handleTelegramOfferRecruiterAction(action(thread, "ors", confirm ?? "", 101));
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects group or mismatched-sender callbacks before accessing candidate data", async () => {
    const thread = fakeThread();
    const event = action(thread, "orc", value);
    event.raw = {
      from: { id: 67_890, username: "other" },
      message: { chat: { id: 12_345, type: "private" }, message_id: 10 },
    };
    await handleTelegramOfferRecruiterAction(event);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
  });
});
