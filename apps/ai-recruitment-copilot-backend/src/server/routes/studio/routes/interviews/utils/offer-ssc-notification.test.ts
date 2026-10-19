import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { member, studioOfferDraft } from "@arc/db-schema/schema";
import { OfferDraftError } from "../dao/offer-drafts";
import { getOfferSscNotificationTargets } from "./offer-ssc-notification";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  current: vi.fn(),
  members: vi.fn(),
  organization: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    query: { organization: { findFirst: mocks.organization } },
    select: mocks.select,
  },
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
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/telegram/ssc-recipients", () => ({
  listSourceSscTelegramRecipients: mocks.members,
}));

const draftId = "550e8400-e29b-41d4-a716-446655440000";
const compactDraftId = "550e8400e29b41d4a716446655440000";
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
  mocks.members.mockResolvedValue([recipient()]);
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
        limit: mocks.current,
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
  it("returns only bound, visible same-workspace members with read and receive permission", async () => {
    mocks.members.mockResolvedValue([
      recipient(),
      recipient("foreign", { organizationId: "org-b", telegramChatId: "20001" }),
      recipient("banned", { banned: true, telegramChatId: "20002" }),
      recipient("unbound", { telegramChatId: null }),
      recipient("numeric", { telegram: "20003", telegramBoundUsername: null }),
      recipient("changed", { telegramBoundUsername: "previous_handle", telegramChatId: "20004" }),
      recipient("no-read", { telegramChatId: "20005" }),
      recipient("no-receive", { telegramChatId: "20006" }),
      recipient("invisible", { telegramChatId: "20007" }),
      recipient("removed", { telegramChatId: "20008" }),
    ]);
    const targets = await getOfferSscNotificationTargets(input);
    expect(targets.map(({ userId, chatId }) => ({ chatId, userId }))).toEqual([
      { chatId: "12345", userId: "ssc-member" },
    ]);
    expect(mocks.context).toHaveBeenCalledWith({
      actorUserId: "ssc-member",
      draftId,
      interviewRecordId: "candidate-a",
      organizationId: "org-a",
    });
  });

  it("sends one card per chat with the existing compact UUID and base36 callback", async () => {
    mocks.members.mockResolvedValue([recipient(), recipient("second-ssc")]);
    const targets = await getOfferSscNotificationTargets(input);
    expect(targets).toHaveLength(1);
    const [target] = targets;
    expect(target?.message).toMatchObject({ title: "Offer待SSC接收确认" });
    const message = JSON.stringify(target?.message);
    expect(message).toContain('"id":"osr"');
    expect(message).toContain(`${compactDraftId}:z`);
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
    mocks.context.mockResolvedValue({
      actorRole: "ssc-reviewer",
      canConfirm: true,
      canReceive: true,
      candidateName: "示例候选人",
      draft,
      pipelineStage: "closed",
    });
    await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
  });

  it.each([
    ["received", "confirming", "确认中", "SSC已接收Offer"],
    ["completed", "completed", "已完成确认", "SSC已完成Offer确认"],
  ] as const)(
    "feedback for %s goes to the Offer creator with a system link",
    async (event, status, label, title) => {
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
    },
  );

  it("does not replace an absent Offer creator with the candidate creator", async () => {
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
    mocks.members.mockResolvedValue([
      recipient("ssc-member", { telegramBoundUsername: "old_handle" }),
    ]);
    await expect(getOfferSscNotificationTargets(input)).resolves.toEqual([]);
  });

  it("does not silently treat permission backend failures as an empty audience", async () => {
    mocks.context.mockRejectedValue(new Error("permission backend unavailable"));
    await expect(getOfferSscNotificationTargets(input)).rejects.toThrow(
      "permission backend unavailable",
    );
  });
});
