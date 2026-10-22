/* oxlint-disable max-lines -- Shared thread state fixtures cover the full Offer approval lifecycle. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ChatSdk from "chat";
import { getTelegramBot, shutdownTelegramBot } from "./bot";
import { OfferDraftError } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { verifyOfferCandidatePreviewToken } from "@arc/ai-recruitment-copilot-backend/server/routes/public/routes/offer-candidates/access";

const mocks = vi.hoisted(() => ({
  actions: new Map<string, (event: unknown) => Promise<void>>(),
  bind: vi.fn(),
  complete: vi.fn(),
  completion: vi.fn(),
  context: vi.fn(),
  direct: vi.fn(),
  edit: vi.fn(),
  history: vi.fn(),
  interaction: vi.fn(),
  interviewSummary: vi.fn(),
  pins: vi.fn(),
  post: vi.fn(),
  receive: vi.fn(),
  sentEdit: vi.fn(),
  slash: new Map<string, (event: unknown) => Promise<void>>(),
  stateWrite: vi.fn(),
  uploadPrompt: vi.fn(),
  users: vi.fn(),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-activity",
  () => ({
    describeOfferSscOperator: (operator: { sscName: string; sscTelegram: string } | null) =>
      operator ? `${operator.sscName}（${operator.sscTelegram}）` : "SSC",
    loadOfferSscActivity: mocks.history,
    recordOfferSscInteraction: mocks.interaction,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-ssc-interview-summary",
  () => ({ loadOfferSscInterviewSummary: mocks.interviewSummary }),
);
vi.mock("./offer-ssc-upload-prompt", () => ({
  postTelegramOfferScreenshotPrompt: mocks.uploadPrompt,
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
vi.mock("./offer-telegram-adapter", () => ({ createOfferTelegramAdapter: vi.fn() }));
vi.mock("chat", async (importOriginal) => ({
  ...(await importOriginal<typeof ChatSdk>()),
  Chat: function MockChat() {
    return {
      getAdapter() {
        return { editMessage: mocks.edit };
      },
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
    vi.fn(async (content: unknown) => {
      nextMessageId += 1;
      const id = nextMessageId;
      sentIds.push(id);
      await mocks.post(content);
      return { edit: mocks.sentEdit, id: `12345:${id}` };
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
  mocks.history.mockResolvedValue([
    {
      action: "offer_ssc_received",
      label: "接收确认",
      occurredAt: "2026-10-21T08:52:00.000Z",
      operator: "秋风（@sscalice）",
    },
  ]);
  mocks.interaction.mockImplementation(() => Promise.resolve());
  mocks.interviewSummary.mockResolvedValue([]);
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
    telegramOperator: {
      responsibilityId: "ssc-responsibility",
      sscName: "秋风",
      sscTelegram: "@sscalice",
      telegramChatId: "12345",
    },
  });
  mocks.receive.mockResolvedValue({ ...draft, sscConfirmationStatus: "confirming" });
  mocks.complete.mockResolvedValue({ ...draft, sscConfirmationStatus: "completed" });
  mocks.completion.mockResolvedValue({ ...draft, sscConfirmationStatus: "completed" });
  mocks.edit.mockResolvedValue({ id: "12345:7" });
  mocks.sentEdit.mockResolvedValue({ id: "12345:8" });
  mocks.uploadPrompt.mockImplementation(
    async (targetThread: ReturnType<typeof thread>, text: string) => {
      const posted = await targetThread.post(text);
      return posted.id;
    },
  );
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

function buttonValue(
  post: ReturnType<typeof thread>["post"] | typeof mocks.edit,
  id: string,
): string {
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
    telegramOperator: {
      responsibilityId: "ssc-responsibility",
      sscName: "秋风",
      sscTelegram: "@sscalice",
      telegramChatId: "12345",
    },
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

  it("keeps completed interview details in Offer copies through open, receive, approval and screenshot cards", async () => {
    const rounds = [
      {
        feedback: "面试点评内容完整，建议推进录用。",
        interviewers: [{ name: "真人面试官甲" }, { name: "外部面试官乙" }],
        label: "技术复面",
        scheduledAt: "2026-10-20T02:30:00.000Z",
        sortOrder: 1,
        status: "completed",
      },
    ];
    const fullDraft = { ...draft, baseSalary: 15_000, currency: "CNY" };
    const context = {
      actorRole: null,
      canConfirm: true,
      canReceive: true,
      candidateName: "候选人甲",
      draft: fullDraft,
      pipelineStage: "offer",
      telegramOperator: {
        responsibilityId: "ssc-responsibility",
        sscName: "秋风",
        sscTelegram: "@sscalice",
        telegramChatId: "12345",
      },
    };
    mocks.context.mockResolvedValue(context);
    mocks.interviewSummary.mockResolvedValue(rounds);
    mocks.receive.mockImplementationOnce(() => {
      expect(mocks.interviewSummary).toHaveBeenCalledWith({
        interviewRecordId: "candidate-a",
        organizationId: "org-a",
      });
      return Promise.resolve({ ...fullDraft, sscConfirmationStatus: "confirming" });
    });
    const opened = await command("/offer", message(draftId));
    expect(JSON.stringify(opened.mock.calls)).toContain("真人面试官甲");
    expect(JSON.stringify(opened.mock.calls)).toContain('"telegramOfferCopyText"');
    mocks.interviewSummary.mockClear();
    await action("osr", `${callbackDraftId}:3`);
    expect(mocks.edit.mock.calls[0][2]).toMatchObject({
      telegramOfferCopyText: expect.stringContaining("外部面试官乙"),
    });
    const completeCallback = buttonValue(mocks.edit, "osc");
    mocks.context.mockResolvedValue({
      ...context,
      draft: { ...fullDraft, sscConfirmationStatus: "confirming" },
    });
    const prompt = await action("osc", completeCallback);
    expect(prompt.mock.calls[0][0]).toMatchObject({
      telegramOfferCopyText: expect.stringContaining("面试点评内容完整，建议推进录用。"),
    });
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    const screenshot = await directMessage(upload.sentIds[0], {
      raw: { photo: [{ file_id: "interview-proof", file_size: 4 }] },
    });
    expect(screenshot.mock.calls[0][0]).toMatchObject({
      telegramOfferCopyText: expect.stringContaining("10:30"),
    });
    expect(buttonValue(screenshot, "osf")).toBeTruthy();
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(mocks.interviewSummary).toHaveBeenCalledWith({
      interviewRecordId: "candidate-a",
      organizationId: "org-a",
    });
  });

  it.each([false, true])(
    "keeps authorized candidate details available for long interviews on a private approval card (screenshot: %s)",
    async (screenshotReceived) => {
      const feedback = "点评内容很长，需要在详情页完整查看。".repeat(200);
      const fullDraft = { ...draft, baseSalary: 15_000, currency: "CNY" };
      mocks.interviewSummary.mockResolvedValue([
        {
          feedback,
          interviewers: [{ name: "面试官甲" }],
          label: "技术复面",
          scheduledAt: "2026-10-20T02:30:00.000Z",
          status: "completed",
        },
      ]);
      let prompt = await beginCompletion(fullDraft);
      if (screenshotReceived) {
        const upload = await action(
          "osu",
          buttonValue(prompt, "osu"),
          callbackMessage(prompt.sentIds[0]),
        );
        prompt = await directMessage(upload.sentIds[0], {
          raw: { photo: [{ file_id: "long-interview-proof", file_size: 4 }] },
        });
      }
      expect(prompt.mock.calls[0][0]).toMatchObject({
        telegramOfferCopyText: expect.stringContaining(feedback),
      });
      const serialized = JSON.stringify(prompt.mock.calls);
      expect(serialized).toContain("内部审批");
      expect(serialized).toContain("查看候选人详情");
      expect(serialized).not.toContain("未配置可用详情地址");
      expect(buttonValue(prompt, "osf")).toMatch(/^[0-9a-f]{32}$/u);
      expect(buttonValue(prompt, "osu")).toMatch(/^[0-9a-f]{32}$/u);
      const previewToken =
        /https:\/\/ats\.example\.test\/offer-candidate\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43})/u.exec(
          serialized,
        )?.[1];
      expect(previewToken).toBeTypeOf("string");
      expect(verifyOfferCandidatePreviewToken(previewToken ?? "")).toMatchObject({
        candidateId: "candidate-a",
        draftId,
        organizationId: "org-a",
        revision: 3,
        telegramActor: { telegramUserId: "12345", username: "SscAlice" },
      });
      expect(mocks.completion).not.toHaveBeenCalled();
      expect(mocks.users).not.toHaveBeenCalled();
    },
  );

  it("does not load interview summaries when Offer authorization is denied", async () => {
    mocks.context.mockRejectedValue(new OfferDraftError("Forbidden", 403));
    await action("osr", `${callbackDraftId}:3`);
    expect(mocks.interviewSummary).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("checks the actual Telegram sender rather than a supplied system user", async () => {
    await action("osr", `${callbackDraftId}:3`);
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.context).toHaveBeenCalledWith({
      draftId,
      telegramActor: { telegramUserId: "12345", username: "SscAlice" },
    });
    expect(mocks.receive).toHaveBeenCalledWith({
      actor: { telegramUserId: "12345", username: "SscAlice" },
      draftId,
      interviewRecordId: "candidate-a",
      organizationId: "org-a",
      revision: 3,
      source: "telegram",
    });
  });

  it("keeps completion available on the received card for its authorized SSC", async () => {
    const post = await action("osr", `${callbackDraftId}:3`);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenCalledWith("telegram:12345", "12345:7", expect.anything());
    const edited = JSON.stringify(mocks.edit.mock.calls[0][2]);
    expect(edited).toContain("确认中");
    expect(edited).toContain('"id":"osc"');
    expect(edited).toContain("秋风（@sscalice）");
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

  it("does not add completion permission to a receive-only authorized context", async () => {
    mocks.context.mockResolvedValue({
      actorRole: "ssc-receiver",
      canConfirm: false,
      canReceive: true,
      candidateName: "候选人甲",
      draft,
      pipelineStage: "offer",
    });
    await action("osr", `${callbackDraftId}:3`);
    expect(mocks.receive).toHaveBeenCalledOnce();
    const edited = JSON.stringify(mocks.edit.mock.calls[0][2]);
    expect(edited).toContain("确认中");
    expect(edited).not.toContain('"id":"osc"');
    expect(edited).not.toContain('"id":"osr"');
  });

  it("opens approval and optional upload from the completion button on the received card", async () => {
    await action("osr", `${callbackDraftId}:3`);
    const completeCallback = buttonValue(mocks.edit, "osc");
    mocks.context.mockResolvedValue({
      actorRole: "ssc-reviewer",
      canConfirm: true,
      canReceive: true,
      candidateName: "候选人甲",
      draft: { ...draft, sscConfirmationStatus: "confirming" },
      pipelineStage: "offer",
      telegramOperator: {
        responsibilityId: "ssc-responsibility",
        sscName: "秋风",
        sscTelegram: "@sscalice",
        telegramChatId: "12345",
      },
    });
    const prompt = await action("osc", completeCallback);
    expect(JSON.stringify(prompt.mock.calls)).toContain("内部审批");
    expect(mocks.completion).not.toHaveBeenCalled();
    const finalCallback = buttonValue(prompt, "osf");
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    expect(mocks.uploadPrompt).toHaveBeenCalledOnce();
    expect(upload.sentIds).toHaveLength(1);
    // Screenshots stay optional: selecting upload does not approve the Offer.
    expect(mocks.completion).not.toHaveBeenCalled();
    await action("osf", finalCallback, callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { telegramUserId: "12345", username: "SscAlice" },
        draftId,
        internalApprovalConfirmed: true,
        revision: 3,
      }),
    );
    expect(JSON.stringify(mocks.edit.mock.calls.at(-1)?.[2])).toContain("已完成确认");
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
  ])(
    "ignores %s system identity when the TG is responsible for the Offer",
    async (_name, users) => {
      mocks.users.mockResolvedValue(users);
      const post = await command("/offer", message(draftId));
      expect(mocks.users).not.toHaveBeenCalled();
      expect(mocks.context).toHaveBeenCalled();
      expect(JSON.stringify(post.mock.calls)).toContain("候选人甲");
    },
  );

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

  it("records the SSC who opens the second confirmation and identifies them in the card", async () => {
    const prompt = await beginCompletion();
    expect(mocks.interaction).toHaveBeenCalledWith(
      expect.anything(),
      "offer_ssc_confirmation_opened",
    );
    const card = JSON.stringify(prompt.mock.calls);
    expect(card).toContain("当前操作人");
    expect(card).toContain("秋风（@sscalice）");
    expect(card).toContain("接收确认");
  });

  it("finishes directly from a broadcast second-confirmation card without a prior local prompt", async () => {
    await beginCompletion();
    threadState = null;
    await action("osf", `${callbackDraftId}:3`);
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { telegramUserId: "12345", username: "SscAlice" },
        internalApprovalConfirmed: true,
        revision: 3,
      }),
    );
  });

  it("opens screenshot upload from a broadcast second-confirmation card", async () => {
    await beginCompletion();
    threadState = null;
    const upload = await action("osu", `${callbackDraftId}:3`);
    expect(mocks.uploadPrompt).toHaveBeenCalledOnce();
    expect(upload.sentIds).toHaveLength(1);
    await directMessage(upload.sentIds[0], {
      raw: { photo: [{ file_id: "broadcast-photo", file_size: 4 }] },
    });
    expect(JSON.stringify(mocks.post.mock.calls)).toContain("审批截图已收到");
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it("does not let an old broadcast card bypass the latest screenshot confirmation", async () => {
    await beginCompletion();
    threadState = null;
    const upload = await action("osu", `${callbackDraftId}:3`);
    const receipt = await directMessage(upload.sentIds[0], {
      raw: { photo: [{ file_id: "broadcast-photo", file_size: 4 }] },
    });
    const stale = await action("osf", `${callbackDraftId}:3`);
    expect(mocks.completion).not.toHaveBeenCalled();
    expect(JSON.stringify(stale.mock.calls)).toContain("过期");
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
    await action("osf", buttonValue(receipt, "osf"), callbackMessage(receipt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.any(File) }),
    );
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
      actor: { telegramUserId: "12345", username: "SscAlice" },
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
        mocks.context.mockRejectedValue(new OfferDraftError("SSC 负责关系或绑定已变更。", 403));
      }
      await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
      expect(mocks.completion).not.toHaveBeenCalled();
      expect(mocks.edit).not.toHaveBeenCalled();
    },
  );

  it("ignores arbitrary images until an Offer upload prompt is selected", async () => {
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

  it.each([true, false])(
    "accepts the selected optional photo and only saves it on explicit confirmation (reply=%s)",
    async (withReply) => {
      const prompt = await beginCompletion();
      const upload = await action(
        "osu",
        buttonValue(prompt, "osu"),
        callbackMessage(prompt.sentIds[0]),
      );
      expect(mocks.uploadPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ id: "telegram:12345" }),
        expect.stringContaining("审批截图"),
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
      const receipt = await directMessage(withReply ? upload.sentIds[0] : undefined, {
        raw: {
          photo: [{ file_id: "photo-one", file_size: screenshot.length, height: 100, width: 100 }],
        },
      });
      expect(mocks.completion).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(receipt.mock.calls)).toContain("截图");
      expect(JSON.stringify(receipt.mock.calls)).toContain("截图已收到");
      expect(buttonValue(receipt, "osf")).toBe(buttonValue(prompt, "osf"));
      expect(mocks.edit).toHaveBeenCalledWith(
        "telegram:12345",
        `12345:${prompt.sentIds[0]}`,
        expect.any(String),
      );
      await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
      expect(mocks.completion).not.toHaveBeenCalled();
      await action("osf", buttonValue(receipt, "osf"), callbackMessage(receipt.sentIds[0]));
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
    },
  );

  it("does not bind a direct photo to an earlier Offer if selecting another upload fails", async () => {
    const first = await beginCompletion();
    await action("osu", buttonValue(first, "osu"), callbackMessage(first.sentIds[0]));
    const second = await beginCompletion({
      ...draft,
      id: "550e8400-e29b-41d4-a716-446655440001",
      interviewRecordId: "candidate-b",
    });
    mocks.uploadPrompt.mockRejectedValueOnce(new Error("Temporary prompt delivery failure"));
    await action("osu", buttonValue(second, "osu"), callbackMessage(second.sentIds[0]));
    await directMessage(undefined, {
      raw: { photo: [{ file_id: "intended-for-second", file_size: 4 }] },
    });
    const pending = threadState?.offerSscCompletions as Record<string, { screenshot?: unknown }>;
    expect(Object.values(pending).every((record) => !record.screenshot)).toBe(true);
    expect(mocks.completion).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "keeps the latest upload selection when an earlier prompt is delivered last (same Offer=%s)",
    async (sameOffer) => {
      const first = await beginCompletion();
      const started = Promise.withResolvers<boolean>();
      const delivery = Promise.withResolvers<string>();
      mocks.uploadPrompt.mockImplementationOnce(async () => {
        started.resolve(true);
        return await delivery.promise;
      });
      const earlier = action("osu", buttonValue(first, "osu"), callbackMessage(first.sentIds[0]));
      await started.promise;
      const latest = sameOffer
        ? first
        : await beginCompletion({
            ...draft,
            id: "550e8400-e29b-41d4-a716-446655440001",
            interviewRecordId: "candidate-b",
          });
      const uploaded = await action(
        "osu",
        buttonValue(latest, "osu"),
        callbackMessage(latest.sentIds[0]),
      );
      delivery.resolve("12345:500");
      await earlier;
      await directMessage(undefined, {
        raw: { photo: [{ file_id: "latest-selection-photo", file_size: 4 }] },
      });
      const pending = threadState?.offerSscCompletions as Record<
        string,
        { screenshot?: { fileId: string }; uploadPromptMessageId?: number }
      >;
      const selected = pending[buttonValue(latest, "osu")];
      expect(selected.uploadPromptMessageId).toBe(uploaded.sentIds[0]);
      expect(selected.screenshot?.fileId).toBe("latest-selection-photo");
      if (!sameOffer) {
        expect(pending[buttonValue(first, "osu")].screenshot).toBeUndefined();
      }
    },
  );

  it.each([false, true])(
    "keeps the original confirmation and screenshot if registering the new card fails (write committed=%s)",
    async (committed) => {
      const prompt = await beginCompletion();
      const upload = await action(
        "osu",
        buttonValue(prompt, "osu"),
        callbackMessage(prompt.sentIds[0]),
      );
      mocks.stateWrite
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {})
        .mockImplementationOnce((value: Record<string, unknown>) => {
          if (committed) {
            threadState = { ...threadState, ...value };
          }
          throw new Error("Temporary confirmation state write failure");
        });
      await directMessage(upload.sentIds[0], {
        raw: { photo: [{ file_id: "photo-one", file_size: 4 }] },
      });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            Response.json({ ok: true, result: { file_path: "photos/proof.jpg", file_size: 4 } }),
          )
          .mockResolvedValueOnce(new Response(Buffer.from("ffd8ffd9", "hex"))),
      );
      await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
      expect(mocks.completion).toHaveBeenCalledWith(
        expect.objectContaining({ file: expect.any(File) }),
      );
    },
  );

  it.each(["recovery failure", "newer screenshot"])(
    "retains the new card when its registration committed but recovery encounters %s",
    async (reason) => {
      const prompt = await beginCompletion();
      const upload = await action(
        "osu",
        buttonValue(prompt, "osu"),
        callbackMessage(prompt.sentIds[0]),
      );
      mocks.stateWrite
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {})
        .mockImplementationOnce((value: Record<string, unknown>) => {
          threadState = { ...threadState, ...value };
          if (reason === "newer screenshot") {
            const pending = value.offerSscCompletions as Record<
              string,
              { screenshot: { fileId: string } }
            >;
            pending[buttonValue(prompt, "osu")].screenshot.fileId = "newer-photo";
          }
          throw new Error("Confirmation registration acknowledgement failed");
        });
      if (reason === "recovery failure") {
        mocks.stateWrite.mockImplementationOnce(() => {
          throw new Error("Recovery state temporarily unavailable");
        });
      }
      const receipt = await directMessage(upload.sentIds[0], {
        raw: { photo: [{ file_id: "photo-one", file_size: 4 }] },
      });
      expect(mocks.sentEdit).not.toHaveBeenCalled();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            Response.json({ ok: true, result: { file_path: "photos/proof.jpg", file_size: 4 } }),
          )
          .mockResolvedValueOnce(new Response(Buffer.from("ffd8ffd9", "hex"))),
      );
      await action("osf", buttonValue(receipt, "osf"), callbackMessage(receipt.sentIds[0]));
      expect(mocks.completion).toHaveBeenCalledWith(
        expect.objectContaining({ file: expect.any(File) }),
      );
    },
  );

  it("keeps the screenshot and original confirmation usable if the new card cannot be delivered", async () => {
    const prompt = await beginCompletion();
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    mocks.post.mockRejectedValueOnce(new Error("Temporary Telegram delivery failure"));
    await directMessage(upload.sentIds[0], {
      raw: { photo: [{ file_id: "photo-one", file_size: 4 }] },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ok: true, result: { file_path: "photos/proof.jpg", file_size: 4 } }),
        )
        .mockResolvedValueOnce(new Response(Buffer.from("ffd8ffd9", "hex"))),
    );
    await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    expect(mocks.completion).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.any(File) }),
    );
  });

  it("removes the new card actions if the Offer completes while that card is being delivered", async () => {
    const prompt = await beginCompletion();
    const upload = await action(
      "osu",
      buttonValue(prompt, "osu"),
      callbackMessage(prompt.sentIds[0]),
    );
    const posting = Promise.withResolvers<boolean>();
    const resume = Promise.withResolvers<boolean>();
    mocks.post.mockImplementationOnce(async () => {
      posting.resolve(true);
      await resume.promise;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ok: true, result: { file_path: "photos/proof.jpg", file_size: 4 } }),
        )
        .mockResolvedValueOnce(new Response(Buffer.from("ffd8ffd9", "hex"))),
    );
    const incoming = directMessage(upload.sentIds[0], {
      raw: { photo: [{ file_id: "photo-one", file_size: 4 }] },
    });
    await posting.promise;
    try {
      await action("osf", buttonValue(prompt, "osf"), callbackMessage(prompt.sentIds[0]));
    } finally {
      resume.resolve(true);
      await incoming;
    }
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.sentEdit).toHaveBeenCalledWith(expect.stringContaining("已失效"));
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
      mocks.context.mockImplementationOnce(async () => {
        started.resolve(true);
        await authorization.promise;
        return check === "completed"
          ? { ...context, draft: { ...context.draft, sscConfirmationStatus: "completed" } }
          : context;
      });
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
