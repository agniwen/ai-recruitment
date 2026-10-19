import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ChatSdk from "chat";
import { getTelegramBot, shutdownTelegramBot } from "./bot";
import { OfferDraftError } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";

const mocks = vi.hoisted(() => ({
  actions: new Map<string, (event: unknown) => Promise<void>>(),
  bind: vi.fn(),
  complete: vi.fn(),
  completion: vi.fn(),
  context: vi.fn(),
  direct: vi.fn(),
  edit: vi.fn(),
  pins: vi.fn(),
  receive: vi.fn(),
  slash: new Map<string, (event: unknown) => Promise<void>>(),
  stateWrite: vi.fn(),
  users: vi.fn(),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-completion",
  () => ({ completeOfferSscWithScreenshot: mocks.completion }),
);
vi.mock("../dao", () => ({ bindTelegramUser: mocks.bind }));
vi.mock("../ssc-recipients", () => ({
  resolveLedgerTelegramOfferActor: () => Promise.resolve(null),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    query: { sscTelegramIdentity: { findMany: mocks.pins }, user: { findMany: mocks.users } },
    transaction: async (operation: (tx: { execute: () => Promise<void> }) => Promise<unknown>) =>
      await operation({ execute: () => Promise.resolve() }),
  },
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
      onDirectMessage(handler: unknown) {
        mocks.direct.mockImplementation(handler as () => Promise<void>);
      },
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
let threadState: Record<string, unknown> | null = null;
let nextMessageId = 100;

function thread() {
  const sentIds: number[] = [];
  const post = Object.assign(
    vi.fn(() => {
      nextMessageId += 1;
      const id = nextMessageId;
      sentIds.push(id);
      return Promise.resolve({ id: `12345:${id}` });
    }),
    { sentIds },
  );
  return {
    id: "telegram:12345",
    post,
    setState(value: Record<string, unknown>, options?: { replace?: boolean }) {
      mocks.stateWrite(value);
      threadState = options?.replace ? value : { ...threadState, ...value };
      return Promise.resolve();
    },
    get state() {
      return Promise.resolve(threadState);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actions.clear();
  mocks.slash.clear();
  mocks.users.mockResolvedValue([boundUser]);
  mocks.pins.mockResolvedValue([]);
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
  mocks.completion.mockResolvedValue({ ...draft, sscConfirmationStatus: "completed" });
  mocks.edit.mockResolvedValue({ id: "12345:7" });
  threadState = null;
  nextMessageId = 100;
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "offer-preview-test-secret-never-used-outside-tests");
  getTelegramBot();
});

afterEach(async () => {
  await shutdownTelegramBot();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

async function action(
  id: string,
  value: string,
  overrides: Record<string, unknown> = {},
  options: { postError?: Error } = {},
) {
  const currentThread = thread();
  if (options.postError) {
    currentThread.post.mockRejectedValue(options.postError);
  }
  const handler = mocks.actions.get(id);
  expect(handler, `${id} action handler`).toBeTypeOf("function");
  await handler?.({
    actionId: id,
    adapter: { editMessage: mocks.edit },
    messageId: `12345:${(overrides.message as { message_id: number } | undefined)?.message_id ?? 7}`,
    raw: {
      data: "ignored",
      from: { id: 12_345, username: "SscAlice" },
      id: "callback-a",
      message: { chat: { id: 12_345, type: "private" }, message_id: 7 },
      ...overrides,
    },
    thread: currentThread,
    threadId: currentThread.id,
    user: { userId: "forged-system-user" },
    value,
  });
  return currentThread.post;
}

function buttonValue(post: ReturnType<typeof thread>["post"], id: string): string {
  let result: string | undefined;
  function visit(value: unknown) {
    if (!value || typeof value !== "object") {
      return;
    }
    const item = value as Record<string, unknown>;
    if (item.id === id && typeof item.value === "string") {
      result = item.value;
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child)) {
        for (const nested of child) {
          visit(nested);
        }
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }
  for (const call of post.mock.calls) {
    visit(call);
  }
  expect(result, `${id} button`).toBeTypeOf("string");
  return result ?? "missing";
}

function callbackMessage(messageId: number) {
  return { message: { chat: { id: 12_345, type: "private" }, message_id: messageId } };
}
async function beginCompletion(targetDraft = draft) {
  mocks.context.mockResolvedValue({
    actorRole: "ssc-reviewer",
    canConfirm: true,
    canReceive: true,
    candidateName: "候选人甲",
    draft: { ...targetDraft, sscConfirmationStatus: "confirming" },
    pipelineStage: "offer",
  });
  return await action("osc", `${targetDraft.id.replaceAll("-", "")}:3`);
}

async function directMessage(
  replyToMessageId?: number,
  options: { attachments?: unknown[]; edited?: boolean; raw?: Record<string, unknown> } = {},
) {
  const currentThread = thread();
  await mocks.direct(currentThread, {
    attachments: options.attachments ?? [],
    id: "12345:999",
    metadata: { edited: options.edited ?? false },
    raw: {
      chat: { id: 12_345, type: "private" },
      from: { id: 12_345, username: "SscAlice" },
      message_id: 999,
      ...(replyToMessageId
        ? {
            reply_to_message: {
              chat: { id: 12_345, type: "private" },
              message_id: replyToMessageId,
            },
          }
        : {}),
      ...(options.edited ? { edit_date: 123 } : {}),
      ...options.raw,
    },
    replyTo: replyToMessageId ? { id: `12345:${replyToMessageId}` } : undefined,
    text: "",
    threadId: currentThread.id,
  });
  return currentThread.post;
}

describe("self-service Telegram Offer SSC actions", () => {
  it("opens an Offer deep link without implicitly rebinding the sender", async () => {
    const post = await command("/start", message(`offer_${draftId}`));
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).toContain("候选人甲");
    expect(JSON.stringify(post.mock.calls)).toContain("Offer新增");
    expect(JSON.stringify(post.mock.calls)).toContain("https://ats.example.test/offer-candidate/");
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

  it("updates the clicked Offer card to confirming and replaces receive with complete", async () => {
    const post = await action("osr", `${callbackDraftId}:3`);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenCalledWith("telegram:12345", "12345:7", expect.anything());
    const edited = JSON.stringify(mocks.edit.mock.calls[0][2]);
    expect(edited).toContain("确认中");
    expect(edited).toContain('"id":"osc"');
    expect(edited).not.toContain('"id":"osr"');
    expect(edited).toContain("https://ats.example.test/offer-candidate/");
    expect(post).not.toHaveBeenCalled();
  });

  it("posts the updated card when editing fails after receive has already succeeded", async () => {
    mocks.edit.mockRejectedValue(new Error("message can't be edited"));
    const post = await action("osr", `${callbackDraftId}:3`);
    expect(mocks.receive).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(post.mock.calls);
    expect(sent).toContain("确认中");
    expect(sent).toContain('"id":"osc"');
    expect(sent).not.toContain("暂时无法处理");
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
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).not.toContain("候选人甲");
  });

  it("preserves the clicked revision so an old card cannot approve a newer Offer", async () => {
    mocks.receive.mockRejectedValue(new OfferDraftError("Offer 已更新，请重新打开。", 400));
    const post = await action("osr", `${callbackDraftId}:2`);
    expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
    expect(post).toHaveBeenCalledWith(expect.stringContaining("已更新"));
  });

  it("opens an explicit internal-approval confirmation without completing on the first click", async () => {
    const post = await beginCompletion();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).toContain("内部审批");
    expect(buttonValue(post, "osf")).toBeTruthy();
    expect(buttonValue(post, "osu")).toBeTruthy();
    expect(buttonValue(post, "osx")).toBeTruthy();
  });

  it("completes without an optional image only after the prompt-bound final confirmation", async () => {
    const prompt = await beginCompletion();
    const post = await action(
      "osf",
      buttonValue(prompt, "osf"),
      callbackMessage(prompt.sentIds[0]),
    );
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.completion).toHaveBeenCalledWith({
      actor: { id: "user-a", role: "ssc-reviewer" },
      draftId,
      internalApprovalConfirmed: true,
      interviewRecordId: "candidate-a",
      organizationId: "org-a",
      revision: 3,
      source: "telegram",
    });
    expect(post).not.toHaveBeenCalled();
    expect(mocks.edit.mock.calls.map((call) => call[1])).toEqual([
      `12345:${prompt.sentIds[0]}`,
      "12345:7",
    ]);
    for (const call of mocks.edit.mock.calls) {
      const updated = JSON.stringify(call[2]);
      expect(updated).toContain("已完成确认");
      expect(updated).not.toContain('"id":"osf"');
      expect(updated).not.toContain('"id":"osc"');
      expect(updated).toContain("https://ats.example.test/offer-candidate/");
    }
  });

  it("completes legacy pending prompts that do not record the original Offer message", async () => {
    const prompt = await beginCompletion();
    const pending = threadState?.offerSscCompletions as Record<string, Record<string, unknown>>;
    for (const record of Object.values(pending)) {
      Reflect.deleteProperty(record, "originMessageId");
    }
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.edit.mock.calls.map((call) => call[1])).toEqual([`12345:${prompt.sentIds[0]}`]);
  });

  it("does not show completed cards when the business transition fails", async () => {
    const prompt = await beginCompletion();
    mocks.completion.mockRejectedValue(new OfferDraftError("审批截图保存失败，请重试。", 400));
    const post = await action(
      "osf",
      buttonValue(prompt, "osf"),
      callbackMessage(prompt.sentIds[0]),
    );
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(JSON.stringify(post.mock.calls)).toContain("保存失败");
    expect(JSON.stringify(post.mock.calls)).not.toContain("已完成确认");
  });

  it("preserves completion success if editing either completed card fails", async () => {
    const prompt = await beginCompletion();
    mocks.edit.mockRejectedValue(new Error("message can't be edited"));
    const post = await action(
      "osf",
      buttonValue(prompt, "osf"),
      callbackMessage(prompt.sentIds[0]),
    );
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(post.mock.calls)).toContain("已完成确认");
    expect(JSON.stringify(post.mock.calls)).not.toContain("暂时无法处理");
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledTimes(1);
  });

  it("updates both completed cards and sends just one fallback if only one edit fails", async () => {
    const prompt = await beginCompletion();
    mocks.edit.mockRejectedValueOnce(new Error("prompt unavailable"));
    const post = await action(
      "osf",
      buttonValue(prompt, "osf"),
      callbackMessage(prompt.sentIds[0]),
    );
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.edit.mock.calls.map((call) => call[1])).toEqual([
      `12345:${prompt.sentIds[0]}`,
      "12345:7",
    ]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(post.mock.calls)).toContain("已完成确认");
  });

  it("keeps committed completion successful and claimed when pending cleanup cannot persist", async () => {
    const prompt = await beginCompletion();
    let cleanupFailed = false;
    mocks.stateWrite.mockImplementation((value: Record<string, unknown>) => {
      const pending = value.offerSscCompletions as Record<string, unknown>;
      if (!cleanupFailed && Object.keys(pending).length === 0) {
        cleanupFailed = true;
        throw new Error("state cleanup unavailable");
      }
    });
    const post = await action(
      "osf",
      buttonValue(prompt, "osf"),
      callbackMessage(prompt.sentIds[0]),
    );
    expect(cleanupFailed).toBe(true);
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.edit.mock.calls)).toContain("已完成确认");
    expect(JSON.stringify(post.mock.calls)).not.toContain("暂时无法处理");
    const pending = threadState?.offerSscCompletions as Record<string, { status: string }>;
    expect(Object.values(pending).map((record) => record.status)).toEqual(["completing"]);
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(Object.values(pending).map((record) => record.status)).toEqual(["completing"]);
  });

  it("does not report an approval failure or reopen a completed operation when all delivery fails", async () => {
    const prompt = await beginCompletion();
    mocks.edit.mockRejectedValue(new Error("edit unavailable"));
    const post = await action(
      "osf",
      buttonValue(prompt, "osf"),
      callbackMessage(prompt.sentIds[0]),
      { postError: new Error("send unavailable") },
    );
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(post.mock.calls)).toContain("已完成确认");
    expect(JSON.stringify(post.mock.calls)).not.toContain("暂时无法处理");
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledTimes(1);
  });

  it("rejects final buttons copied to another message and rejects replay after completion", async () => {
    const prompt = await beginCompletion();
    const token = buttonValue(prompt, "osf");
    await action("osf", token, callbackMessage(7));
    expect(mocks.completion).not.toHaveBeenCalled();
    await action("osf", token, callbackMessage(prompt.sentIds[0]));
    await action("osf", token, callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending prompt and refuses a later final click", async () => {
    const prompt = await beginCompletion();
    await action("osx", buttonValue(prompt, "osx"), callbackMessage(prompt.sentIds[0]));
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it.each(["revision", "permission", "expiry", "binding"])(
    "fails closed when pending confirmation loses %s",
    async (reason) => {
      const prompt = await beginCompletion();
      if (reason === "revision") {
        mocks.context.mockResolvedValue({
          actorRole: "ssc-reviewer",
          canConfirm: true,
          draft: { ...draft, sscConfirmationStatus: "confirming", sscRevision: 4 },
          pipelineStage: "offer",
        });
      }
      if (reason === "permission") {
        mocks.context.mockRejectedValue(new OfferDraftError("无权访问此 Offer。", 403));
      }
      if (reason === "expiry") {
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
      }
      if (reason === "binding") {
        mocks.users.mockResolvedValue([]);
      }
      await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
      expect(mocks.completion).not.toHaveBeenCalled();
      expect(mocks.edit).not.toHaveBeenCalled();
    },
  );

  it("ignores arbitrary images and requires a reply to the specific upload prompt", async () => {
    const prompt = await beginCompletion();
    const fetchData = vi.fn(() => Promise.resolve(Buffer.from("ffd8ffd9", "hex")));
    await directMessage(undefined, {
      attachments: [{ fetchData, mimeType: "image/jpeg", type: "image" }],
    });
    await directMessage(prompt.sentIds[0], {
      attachments: [{ fetchData, mimeType: "image/jpeg", type: "image" }],
    });
    expect(fetchData).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("accepts a correlated optional photo then passes its bytes only on explicit final confirmation", async () => {
    const prompt = await beginCompletion();
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    const screenshot = Buffer.from("ffd8ffd9", "hex");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          result: { file_path: "photos/proof.jpg", file_size: screenshot.length },
        }),
      )
      .mockResolvedValueOnce(
        new Response(screenshot, {
          headers: { "content-length": String(screenshot.length), "content-type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const receipt = await directMessage(upload.sentIds[0], {
      raw: {
        photo: [{ file_id: "photo-one", file_size: screenshot.length, height: 100, width: 100 }],
      },
    });
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(receipt.mock.calls)).toContain("截图");
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    const [[input]] = mocks.completion.mock.calls;
    expect(input).toMatchObject({
      draftId,
      internalApprovalConfirmed: true,
      revision: 3,
      source: "telegram",
    });
    expect(input.file).toBeInstanceOf(File);
    expect(Buffer.from(await input.file.arrayBuffer())).toEqual(screenshot);
    expect(fetch.mock.calls.every((call) => call[1]?.signal instanceof AbortSignal)).toBe(true);
  });

  it.each(["binding", "authorization", "completed"])(
    "keeps a received screenshot attached when final confirmation overlaps its %s check",
    async (check) => {
      const prompt = await beginCompletion();
      const upload = await action(
        "osu",
        buttonValue(prompt, "osu"),
        callbackMessage(prompt.sentIds[0]),
      );
      const context = await mocks.context.getMockImplementation()?.();
      const started = Promise.withResolvers<boolean>();
      const authorization = Promise.withResolvers<boolean>();
      if (check === "binding") {
        mocks.users.mockImplementationOnce(async () => {
          started.resolve(true);
          await authorization.promise;
          return [boundUser];
        });
      } else {
        mocks.context.mockImplementationOnce(async () => {
          started.resolve(true);
          await authorization.promise;
          return check === "completed"
            ? { ...context, draft: { ...context.draft, sscConfirmationStatus: "completed" } }
            : context;
        });
      }
      const screenshot = Buffer.from("ffd8ffd9", "hex");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            Response.json({
              ok: true,
              result: { file_path: "photos/proof.jpg", file_size: screenshot.length },
            }),
          )
          .mockResolvedValueOnce(new Response(screenshot)),
      );
      const incoming = directMessage(upload.sentIds[0], {
        raw: { photo: [{ file_id: "photo-race", file_size: screenshot.length }] },
      });
      await started.promise;
      let receipt: ReturnType<typeof thread>["post"] | undefined;
      try {
        await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
      } finally {
        authorization.resolve(true);
        receipt = await incoming;
      }
      expect(mocks.completion).toHaveBeenCalledTimes(1);
      expect(mocks.completion.mock.calls[0][0].file).toBeInstanceOf(File);
      expect(JSON.stringify(receipt?.mock.calls)).not.toContain("当前不能完成");
    },
  );

  it("does not associate an edited or unrelated upload reply with any Offer", async () => {
    const prompt = await beginCompletion();
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    const photo = { photo: [{ file_id: "photo-one", file_size: 4, height: 100, width: 100 }] };
    await directMessage(upload.sentIds[0] + 10, { raw: photo });
    await directMessage(upload.sentIds[0], { edited: true, raw: photo });
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.not.objectContaining({ file: expect.anything() }),
    );
  });

  it("rejects a screenshot larger than 10 MB without downloading or completing", async () => {
    const prompt = await beginCompletion();
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const receipt = await directMessage(upload.sentIds[0], {
      raw: {
        document: {
          file_id: "large-photo",
          file_name: "proof.png",
          file_size: 10 * 1024 * 1024 + 1,
          mime_type: "image/png",
        },
      },
    });
    expect(JSON.stringify(receipt.mock.calls)).toContain("10 MB");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("keeps two Offer prompts isolated so one cancellation does not affect another Offer", async () => {
    const first = await beginCompletion();
    const secondDraft = {
      ...draft,
      id: "550e8400-e29b-41d4-a716-446655440001",
      interviewRecordId: "candidate-b",
    };
    const second = await beginCompletion(secondDraft);
    await action("osx", buttonValue(first, "osx"), callbackMessage(first.sentIds[0]));
    await action("osf", buttonValue(second, "osf"), callbackMessage(second.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: secondDraft.id,
        internalApprovalConfirmed: true,
        interviewRecordId: "candidate-b",
      }),
    );
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
