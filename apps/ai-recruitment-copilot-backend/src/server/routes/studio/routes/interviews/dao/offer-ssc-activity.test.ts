import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  describeOfferSscOperator,
  loadOfferSscActivity,
  recordOfferSscInteraction,
} from "./offer-ssc-activity";

const mocks = vi.hoisted(() => ({ record: vi.fn(), rows: vi.fn(), where: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: () => {
      const query = {
        from: () => query,
        limit: mocks.rows,
        orderBy: () => query,
        where: (condition: unknown) => {
          mocks.where(condition);
          return query;
        },
      };
      return query;
    },
  },
}));
vi.mock("../utils/candidate-activity", () => ({ recordCandidateActivity: mocks.record }));

const draft = {
  id: "offer-a",
  interviewRecordId: "candidate-a",
  organizationId: "org-a",
  sscRevision: 3,
  version: 4,
};
const telegramOperator = {
  responsibilityId: "responsibility-a",
  sscName: "秋风",
  sscTelegram: "@qiufeng034",
  telegramChatId: "12345",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows.mockResolvedValue([]);
  mocks.record.mockImplementation(() => Promise.resolve());
});

describe("SSC operation snapshots", () => {
  it("loads only this Offer revision and displays the recorded actors in chronological order", async () => {
    mocks.rows.mockResolvedValue([
      {
        action: "offer_ssc_completed",
        createdAt: new Date("2026-10-21T08:54:00Z"),
        detail: { sscName: "古古", sscTelegram: "@guguda1643" },
      },
      {
        action: "offer_ssc_received",
        createdAt: new Date("2026-10-21T08:52:00Z"),
        detail: telegramOperator,
      },
    ]);
    const history = await loadOfferSscActivity(draft);
    expect(history).toEqual([
      {
        action: "offer_ssc_received",
        label: "接收确认",
        occurredAt: "2026-10-21T08:52:00.000Z",
        operator: "秋风（@qiufeng034）",
      },
      {
        action: "offer_ssc_completed",
        label: "完成确认",
        occurredAt: "2026-10-21T08:54:00.000Z",
        operator: "古古（@guguda1643）",
      },
    ]);
    const condition = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(condition.params).toEqual(
      expect.arrayContaining(["org-a", "candidate-a", "offer-a", "3"]),
    );
    expect(mocks.rows).toHaveBeenCalledWith(8);
  });

  it.each([
    "offer_ssc_confirmation_opened",
    "offer_ssc_upload_requested",
    "offer_ssc_screenshot_uploaded",
    "offer_ssc_confirmation_cancelled",
  ] as const)("records %s with the exact SSC TG instead of a system user", async (action) => {
    await recordOfferSscInteraction({ draft, telegramOperator }, action);
    expect(mocks.record).toHaveBeenCalledWith({
      action,
      detail: {
        ...telegramOperator,
        channel: "telegram",
        draftId: "offer-a",
        revision: 3,
        version: 4,
      },
      interviewRecordId: "candidate-a",
      operatorId: null,
      organizationId: "org-a",
      source: "api",
    });
  });

  it("does not manufacture a TG actor for a system operation", async () => {
    await recordOfferSscInteraction(
      { draft, telegramOperator: null },
      "offer_ssc_confirmation_opened",
    );
    expect(mocks.record).not.toHaveBeenCalled();
    expect(describeOfferSscOperator(telegramOperator)).toBe("秋风（@qiufeng034）");
  });
});
