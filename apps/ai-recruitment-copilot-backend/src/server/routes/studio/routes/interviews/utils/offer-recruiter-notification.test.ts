import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import { OfferDraftError } from "../dao/offer-drafts";
import { getOfferRecruiterNotificationTargets } from "./offer-recruiter-notification";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  current: vi.fn(),
  joins: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));
vi.mock("../dao/offer-recruiter-contact", () => ({
  loadOfferRecruiterContactContext: mocks.context,
}));
vi.mock("../dao/offer-drafts", () => ({
  OfferDraftError: class extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const input = {
  draftId: "550e8400-e29b-41d4-a716-446655440000",
  event: "recruiter" as const,
  interviewRecordId: "candidate-a",
  organizationId: "org-a",
  revision: 3,
};
const row = {
  banned: false,
  expiresAt: null,
  id: input.draftId,
  interviewRecordId: input.interviewRecordId,
  membershipId: "membership-a",
  organizationId: input.organizationId,
  pipelineStage: "offer",
  recruiterConfirmationStatus: "pending",
  recruiterUserId: "resume-uploader",
  sscRevision: input.revision,
  status: "draft",
  telegram: "@Recruiter_Name",
  telegramBoundUsername: "recruiter_name",
  telegramChatId: "12345",
  userId: "resume-uploader",
  version: 4,
};
const context: OfferRecruiterContactState = {
  canConfirm: true,
  candidateDetailUrl: "https://ats.example.test/w/recruiter-workspace/studio/resumes/candidate-a",
  candidateName: "候选人甲",
  candidatePrivateTelegram: "@candidate_name",
  draftId: input.draftId,
  interviewRecordId: input.interviewRecordId,
  notificationIssue: null,
  organizationId: input.organizationId,
  position: "工程师",
  recruiterName: "招聘人员甲",
  revision: input.revision,
  status: "pending",
  version: 4,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T08:00:00Z"));
  mocks.current.mockResolvedValue([row]);
  mocks.context.mockResolvedValue(context);
  mocks.select.mockImplementation(() => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockImplementation((...args) => {
        mocks.joins(...args);
        return chain;
      }),
      limit: mocks.current,
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((condition) => {
        mocks.where(condition);
        return chain;
      }),
    };
    return chain;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Offer recruiter notification targets", () => {
  it("notifies only the bound current resume uploader with an actionable recruiter card", async () => {
    const targets = await getOfferRecruiterNotificationTargets(input);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      chatId: "12345",
      userId: "recruiter:resume-uploader:telegram:12345",
    });
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith({
      draftId: input.draftId,
      interviewRecordId: input.interviewRecordId,
      organizationId: input.organizationId,
      telegramActor: { telegramUserId: "12345", username: "recruiter_name" },
    });
    const card = JSON.stringify(targets[0].message);
    expect(card).toContain("候选人甲");
    expect(card).toContain("私人 TG");
    expect(card).toContain(context.candidateDetailUrl);
    expect(card).toContain("查看候选人详情");
    expect(card).toContain('"id":"orc"');
    expect(card).toContain('"id":"ors"');
    expect(card).not.toContain('"id":"osr"');
  });

  it("queries the highest version within the workspace and candidate without hiding tombstones", async () => {
    await getOfferRecruiterNotificationTargets(input);
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.params).toEqual(["org-a", "candidate-a"]);
    expect(query.sql).not.toContain('"status"');
    expect(query.sql).not.toContain('"recruiter_confirmation_status"');
    expect(mocks.joins).toHaveBeenCalledTimes(3);
  });

  it.each([
    { id: "newer-version", status: "deleted" },
    { id: "newer-version", status: "draft" },
    { status: "superseded" },
    { pipelineStage: "closed" },
    { sscRevision: 4 },
    { recruiterConfirmationStatus: "completed" },
    { expiresAt: new Date("2026-10-22T07:59:59Z") },
    { banned: true },
    { membershipId: null },
    { recruiterUserId: null },
    { userId: "different-user" },
    { telegram: "@changed_handle" },
    { telegramBoundUsername: null },
    { telegramChatId: "-10012345" },
    { telegramChatId: null },
  ])("does not notify a stale, unauthorized or unbound uploader: %j", async (patch) => {
    mocks.current.mockResolvedValue([{ ...row, ...patch }]);
    await expect(getOfferRecruiterNotificationTargets(input)).resolves.toEqual([]);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("does not reuse this branch for SSC events", async () => {
    await expect(
      getOfferRecruiterNotificationTargets({ ...input, event: "pending" }),
    ).resolves.toEqual([]);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([
    { canConfirm: false },
    { status: "completed" },
    { revision: 4 },
    { draftId: "another-draft" },
    { organizationId: "another-org" },
    { interviewRecordId: "another-candidate" },
  ])("rechecks the live authorized context before producing a card: %j", async (patch) => {
    mocks.context.mockResolvedValue({ ...context, ...patch });
    await expect(getOfferRecruiterNotificationTargets(input)).resolves.toEqual([]);
  });

  it.each([403, 404, 409] as const)(
    "abandons an obsolete task when authorization returns %s",
    async (status) => {
      mocks.context.mockRejectedValue(new OfferDraftError("当前任务无效。", status));
      await expect(getOfferRecruiterNotificationTargets(input)).resolves.toEqual([]);
    },
  );

  it("propagates database failures so the durable notification task can retry", async () => {
    mocks.context.mockRejectedValue(new Error("database unavailable"));
    await expect(getOfferRecruiterNotificationTargets(input)).rejects.toThrow(
      "database unavailable",
    );
  });
});
