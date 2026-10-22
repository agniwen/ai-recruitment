import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { interviewAuditLog, member, studioOfferDraft } from "@arc/db-schema/schema";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { OfferDraftError } from "../dao/offer-drafts";
import { getOfferSscNotificationTargets } from "./offer-ssc-notification";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  context: vi.fn(),
  current: vi.fn(),
  interviewSummary: vi.fn(),
  members: vi.fn(),
  organization: vi.fn(),
  recipients: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    query: { organization: { findFirst: mocks.organization } },
    select: mocks.select,
  },
}));
vi.mock("../dao/offer-ssc-interview-summary", () => ({
  loadOfferSscInterviewSummary: mocks.interviewSummary,
}));
vi.mock("../dao/offer-drafts", () => ({
  OfferDraftError: class extends Error {
    readonly status: number;
    constructor(errorMessage: string, status: number) {
      super(errorMessage);
      this.status = status;
    }
  },
  loadAuthorizedOfferSscContext: mocks.context,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/telegram/ssc-notification-recipients",
  () => ({
    listSourceSscNotificationRecipients: mocks.recipients,
  }),
);

const draftId = "550e8400-e29b-41d4-a716-446655440000";
const input = {
  draftId,
  event: "pending" as const,
  interviewRecordId: "candidate-a",
  organizationId: "org-a",
  revision: 35,
};
const draft = {
  approvalAttachment: { filename: "private-approval.png" },
  baseSalary: 987_654_321,
  createdBy: "offer-creator",
  expiresAt: null,
  id: draftId,
  interviewRecordId: "candidate-a",
  organizationId: "org-a",
  position: "工程师",
  sscConfirmationStatus: "pending",
  sscRevision: 35,
  status: "draft",
  version: 2,
};

function recipient(userId = "ssc-member", patch: Record<string, unknown> = {}) {
  return {
    banned: false,
    organizationId: "org-a",
    telegram: `@${userId.replaceAll("-", "_")}`,
    telegramBoundUsername: userId.replaceAll("-", "_"),
    telegramChatId: "12345",
    userId,
    ...patch,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test/");
  vi.stubEnv("BETTER_AUTH_URL", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "offer-preview-test-secret-never-used-outside-tests");
  mocks.current.mockResolvedValue([draft]);
  mocks.audit.mockResolvedValue([]);
  mocks.interviewSummary.mockResolvedValue([]);
  mocks.members.mockResolvedValue([recipient()]);
  mocks.recipients.mockResolvedValue([
    { candidateName: "示例候选人", chatId: "12345", pipelineStage: "offer", username: "sscalice" },
  ]);
  mocks.organization.mockResolvedValue({ id: "org-a", slug: "work" });
  mocks.context.mockImplementation(({ actorUserId }) => {
    if (["no-read", "invisible", "removed"].includes(actorUserId)) {
      return Promise.reject(new OfferDraftError("Forbidden", 403));
    }
    return Promise.resolve({
      actorRole: "ssc-reviewer",
      canConfirm: true,
      canReceive: actorUserId !== "no-receive",
      candidateName: "示例候选人",
      draft,
      pipelineStage: "human_interview",
    });
  });
  mocks.select.mockImplementation(() => ({
    from(table: unknown) {
      const chain = {
        innerJoin: vi.fn().mockReturnThis(),
        limit: table === interviewAuditLog ? mocks.audit : mocks.current,
        orderBy: vi.fn(),
        where: vi.fn(),
      };
      chain.where.mockImplementation((condition) => {
        mocks.where(table, condition);
        return chain;
      });
      chain.orderBy.mockImplementation(() => (table === member ? mocks.members() : chain));
      return chain;
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("SSC notification recipients and cards", () => {
  it("does not notify SSC before the recruiter confirms the candidate private TG", async () => {
    mocks.current.mockResolvedValue([{ ...draft, recruiterConfirmationStatus: "pending" }]);
    await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
    expect(mocks.recipients).not.toHaveBeenCalled();
  });

  it("loads and delivers the saved Offer confirmation content to the responsible SSC", async () => {
    const confirmationInfo = offerConfirmationDetailsSchema.parse({
      candidateCode: "SSC-SNAPSHOT-01",
      candidateName: "保存的候选人姓名",
      probationPeriod: "2个月",
      probationSalary: 10_000,
      workMode: "远程",
    });
    mocks.current.mockResolvedValue([
      { ...draft, baseSalary: 15_000, confirmationInfo, currency: "CNY" },
    ]);
    const [target] = await getOfferSscNotificationTargets(input);
    expect(mocks.select).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSalary: studioOfferDraft.baseSalary,
        confirmationInfo: studioOfferDraft.confirmationInfo,
        currency: studioOfferDraft.currency,
      }),
    );
    const text = JSON.stringify(target?.message);
    expect(text).toContain("SSC-SNAPSHOT-01");
    expect(text).toContain("保存的候选人姓名");
    expect(text).toContain("转正薪资：15K");
    expect(text).toContain("试用薪资：10K");
    expect(text).toContain("系统记录编码：candidate-a");
    expect(text).not.toContain("打开全文复制页");
    expect(text).toContain("查看候选人详情");
    expect(text).not.toContain("private-approval.png");
  });

  it.each([
    ["pending", "pending", "osr"],
    ["received", "confirming", "osf"],
    ["completed", "completed", null],
  ] as const)(
    "loads completed interview details once for all SSC %s notifications",
    async (event, status, actionId) => {
      mocks.current.mockResolvedValue([
        {
          ...draft,
          baseSalary: 15_000,
          createdBy: null,
          currency: "CNY",
          sscConfirmationStatus: status,
        },
      ]);
      mocks.recipients.mockResolvedValue([
        {
          candidateName: "示例候选人",
          chatId: "12345",
          pipelineStage: "offer",
          username: "sscalice",
        },
        {
          candidateName: "示例候选人",
          chatId: "67890",
          pipelineStage: "offer",
          username: "sscbob",
        },
      ]);
      mocks.interviewSummary.mockResolvedValue([
        {
          feedback: "真实面试点评应进入通知与复制文本。",
          interviewers: [{ name: "内部面试官" }, { name: "外部面试官" }],
          label: "业务复面",
          scheduledAt: "2026-10-20T02:30:00.000Z",
          sortOrder: 1,
          status: "completed",
        },
      ]);
      const targets = await getOfferSscNotificationTargets({ ...input, event });
      expect(targets).toHaveLength(2);
      expect(mocks.interviewSummary).toHaveBeenCalledOnce();
      expect(mocks.interviewSummary).toHaveBeenCalledWith({
        interviewRecordId: "candidate-a",
        organizationId: "org-a",
      });
      for (const target of targets) {
        expect(target.message).toMatchObject({
          telegramOfferCopyText: expect.stringContaining("真实面试点评应进入通知与复制文本。"),
        });
        const message = JSON.stringify(target.message);
        expect(message).toContain("内部面试官");
        expect(message).toContain("外部面试官");
        expect(message).toContain("10:30");
        if (actionId) {
          expect(message).toContain(`"id":"${actionId}"`);
        } else {
          expect(message).not.toContain('"id":"osc"');
        }
      }
    },
  );

  it("notifies the responsible SSC chat without resolving system accounts or their permissions", async () => {
    mocks.context.mockRejectedValue(new Error("System account lookup must not run"));
    mocks.members.mockRejectedValue(new Error("System account lookup must not run"));
    const targets = await getOfferSscNotificationTargets(input);
    expect(targets.map(({ userId, chatId }) => ({ chatId, userId }))).toEqual([
      { chatId: "12345", userId: "telegram:12345" },
    ]);
    expect(mocks.recipients).toHaveBeenCalledWith({
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
    });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it("keeps the receive callback and read-only candidate preview without requiring an approval identity to send", async () => {
    mocks.recipients.mockResolvedValue([
      {
        candidateName: "示例候选人",
        chatId: "12345",
        pipelineStage: "offer",
        username: "sscalice",
      },
      {
        candidateName: "示例候选人",
        chatId: "12345",
        pipelineStage: "offer",
        username: "sscalice",
      },
    ]);
    const targets = await getOfferSscNotificationTargets(input);
    expect(targets).toHaveLength(1);
    const [target] = targets;
    expect(target?.message).toMatchObject({ title: "Offer待SSC接收确认" });
    const message = JSON.stringify(target?.message);
    expect(message).toContain('"id":"osr"');
    expect(message).toContain("接收确认");
    expect(message).toContain("550e8400e29b41d4a716446655440000:z");
    expect(message).not.toContain('"id":"osc"');
    expect(message).toContain("查看候选人详情");
    expect(message).toContain("https://ats.example.test/offer-candidate/");
    expect(message).not.toContain("登录系统查看并审核");
    expect(message).toContain("Offer新增");
    expect(message).not.toContain("987654321");
    expect(message).not.toContain("private-approval.png");
  });

  it("scopes the true highest-version lookup without filtering out tombstones", async () => {
    await getOfferSscNotificationTargets(input);
    const condition = mocks.where.mock.calls.find(([table]) => table === studioOfferDraft)?.[1];
    expect(condition).toBeDefined();
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.params).toEqual(["org-a", "candidate-a"]);
    expect(query.sql).not.toContain('"status"');
  });

  it.each([
    ["deleted", 3],
    ["superseded", 3],
    ["draft", 3],
  ])(
    "does not fall back from a newer %s version %s to an old notification",
    async (status, version) => {
      mocks.current.mockResolvedValue([{ ...draft, id: "newer-draft", status, version }]);
      await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
      expect(mocks.context).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...draft, organizationId: "org-b" },
    { ...draft, interviewRecordId: "candidate-b" },
    { ...draft, sscRevision: 36 },
    { ...draft, sscConfirmationStatus: "confirming" },
    { ...draft, status: "sent" },
    { ...draft, status: "expired" },
    { ...draft, expiresAt: new Date("2026-10-17T07:59:59Z") },
  ])("skips a stale or inactive pending event: %j", async (current) => {
    mocks.current.mockResolvedValue([current]);
    await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
  });

  it("does not send pending work for a closed candidate", async () => {
    mocks.recipients.mockResolvedValue([]);
    await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
  });

  it.each([
    ["received", "confirming", "确认中", "SSC已接收Offer"],
    ["completed", "completed", "已完成确认", "SSC已完成Offer确认"],
  ] as const)(
    "feedback for %s goes to the Offer creator with a system link",
    async (event, status, label, title) => {
      mocks.recipients.mockResolvedValue([]);
      const current = { ...draft, sscConfirmationStatus: status };
      mocks.current.mockResolvedValue([current]);
      mocks.members.mockResolvedValue([
        recipient("candidate-creator", { telegramChatId: "20001" }),
        recipient("offer-creator", { telegramChatId: "20002" }),
        recipient("ssc-member", { telegramChatId: "20003" }),
      ]);
      mocks.context.mockResolvedValue({
        actorRole: "offer-issuer",
        canConfirm: true,
        canReceive: false,
        candidateName: "示例候选人",
        draft: current,
        pipelineStage: "offer",
      });
      const targets = await getOfferSscNotificationTargets({ ...input, event });
      expect(targets.map(({ userId }) => userId)).toEqual(["offer-creator"]);
      const [target] = targets;
      expect(target?.message).toMatchObject({ title });
      const message = JSON.stringify(target?.message);
      expect(message).toContain(label);
      expect(message).toContain("https://ats.example.test/offer-candidate/");
      expect(message).not.toContain("/w/work/studio/resumes/");
      expect(message).not.toContain('"id":"osr"');
      expect(message).not.toContain('"id":"osc"');
      expect(mocks.interviewSummary).not.toHaveBeenCalled();
      expect(message).not.toContain("【面试情况】");
    },
  );

  it("does not replace an absent Offer creator with the candidate creator", async () => {
    mocks.recipients.mockResolvedValue([]);
    mocks.current.mockResolvedValue([
      { ...draft, createdBy: null, sscConfirmationStatus: "completed" },
    ]);
    await expect(getOfferSscNotificationTargets({ ...input, event: "completed" })).resolves.toEqual(
      [],
    );
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it.each([
    ["received", "pending"],
    ["completed", "confirming"],
  ] as const)("does not send %s feedback for state %s", async (event, status) => {
    mocks.current.mockResolvedValue([{ ...draft, sscConfirmationStatus: status }]);
    await expect(getOfferSscNotificationTargets({ ...input, event })).resolves.toEqual([]);
  });

  it.each(["draft", "sent", "accepted"])(
    "keeps completed feedback for %s even after the candidate closes",
    async (status) => {
      mocks.recipients.mockResolvedValue([]);
      const current = { ...draft, sscConfirmationStatus: "completed", status };
      mocks.current.mockResolvedValue([current]);
      mocks.members.mockResolvedValue([recipient("offer-creator")]);
      mocks.context.mockResolvedValue({
        actorRole: "offer-issuer",
        canConfirm: false,
        canReceive: false,
        candidateName: "示例候选人",
        draft: current,
        pipelineStage: "closed",
      });
      const targets = await getOfferSscNotificationTargets({ ...input, event: "completed" });
      expect(targets.map(({ userId }) => userId)).toEqual(["offer-creator"]);
    },
  );

  it.each([
    ["confirming", "draft", "确认中"],
    ["completed", "draft", "已完成确认"],
    ["completed", "sent", "已完成确认"],
    ["completed", "accepted", "已完成确认"],
  ])(
    "keeps received feedback after state %s and Offer status %s",
    async (sscStatus, status, label) => {
      mocks.recipients.mockResolvedValue([]);
      const current = { ...draft, sscConfirmationStatus: sscStatus, status };
      mocks.current.mockResolvedValue([current]);
      mocks.members.mockResolvedValue([recipient("offer-creator")]);
      mocks.context.mockResolvedValue({
        actorRole: "offer-issuer",
        canConfirm: true,
        canReceive: true,
        candidateName: "示例候选人",
        draft: current,
        pipelineStage: "closed",
      });
      const targets = await getOfferSscNotificationTargets({ ...input, event: "received" });
      expect(targets.map(({ userId }) => userId)).toEqual(["offer-creator"]);
      const [target] = targets;
      expect(target?.message).toMatchObject({ title: "SSC已接收Offer" });
      const message = JSON.stringify(target?.message);
      expect(message).toContain(label);
      expect(message).toContain("本次反馈");
      expect(message).toContain("SSC接收确认");
      expect(message).not.toContain('"id":"osr"');
      expect(message).not.toContain('"id":"osc"');
    },
  );

  it.each([
    { ...draft, sscConfirmationStatus: "completed", sscRevision: 36 },
    { ...draft, id: "newer-offer", sscConfirmationStatus: "completed", version: 3 },
    { ...draft, sscConfirmationStatus: "completed", status: "deleted" },
    { ...draft, sscConfirmationStatus: "completed", status: "superseded" },
    { ...draft, sscConfirmationStatus: "completed", status: "expired" },
    { ...draft, sscConfirmationStatus: "completed", status: "declined" },
  ])("does not retain received feedback for a stale or retired Offer: %j", async (current) => {
    mocks.current.mockResolvedValue([current]);
    await expect(getOfferSscNotificationTargets({ ...input, event: "received" })).resolves.toEqual(
      [],
    );
  });

  it("rechecks the current binding on a later delivery attempt", async () => {
    const first = await getOfferSscNotificationTargets(input);
    expect(first).toHaveLength(1);
    mocks.recipients.mockResolvedValue([]);
    await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
  });

  it.each(["received", "completed"] as const)(
    "fans out %s to all responsible SSCs without an Offer creator or system identity",
    async (event) => {
      const status = event === "received" ? "confirming" : "completed";
      mocks.current.mockResolvedValue([
        { ...draft, createdBy: null, sscConfirmationStatus: status },
      ]);
      mocks.recipients.mockResolvedValue([
        {
          candidateName: "示例候选人",
          chatId: "12345",
          pipelineStage: "offer",
          username: "ssc_alice",
        },
        {
          candidateName: "示例候选人",
          chatId: "67890",
          pipelineStage: "offer",
          username: "ssc_bob",
        },
      ]);
      mocks.audit.mockResolvedValue([
        {
          action: event === "received" ? "offer_ssc_received" : "offer_ssc_completed",
          createdAt: new Date("2026-10-17T07:55:00Z"),
          detail: { sscName: "秋风", sscTelegram: "@ssc_alice" },
        },
      ]);
      const targets = await getOfferSscNotificationTargets({ ...input, event });
      expect(targets.map((target) => target.chatId)).toEqual(["12345", "67890"]);
      expect(mocks.members).not.toHaveBeenCalled();
      expect(mocks.context).not.toHaveBeenCalled();
      for (const target of targets) {
        const card = JSON.stringify(target.message);
        expect(card).toContain("秋风");
        // Literal field values escape Markdown punctuation before Telegram rendering.
        expect(card).toContain("@ssc\\\\_alice");
        expect(card).toContain("/offer-candidate/");
        expect(card).not.toContain('"id":"osr"');
        if (event === "received") {
          expect(card).toContain('"id":"osf"');
          expect(card).toContain('"id":"osu"');
          expect(card).toContain("确认完成");
        } else {
          expect(card).not.toContain('"id":"osf"');
          expect(card).not.toContain('"id":"osu"');
          expect(card).not.toContain('"id":"osc"');
        }
      }
    },
  );

  it("does not reopen second confirmation when a received event is delivered after completion", async () => {
    mocks.current.mockResolvedValue([
      { ...draft, createdBy: null, sscConfirmationStatus: "completed" },
    ]);
    const targets = await getOfferSscNotificationTargets({ ...input, event: "received" });
    expect(targets).toHaveLength(1);
    const card = JSON.stringify(targets[0].message);
    expect(card).toContain("已完成确认");
    expect(card).not.toContain('"id":"osf"');
    expect(card).not.toContain('"id":"osu"');
  });

  it("does not silently treat permission backend failures as an empty audience", async () => {
    mocks.current.mockResolvedValue([{ ...draft, sscConfirmationStatus: "completed" }]);
    mocks.members.mockResolvedValue([recipient("offer-creator", { telegramChatId: "20002" })]);
    mocks.context.mockRejectedValue(new Error("permission backend unavailable"));
    await expect(getOfferSscNotificationTargets({ ...input, event: "completed" })).rejects.toThrow(
      "permission backend unavailable",
    );
  });
});
