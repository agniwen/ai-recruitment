import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanInterviewRoundRecord } from "@arc/shared/studio-pipeline-stages";
import { loadOfferSscInterviewSummary } from "./offer-ssc-interview-summary";

const mocks = vi.hoisted(() => ({ rounds: vi.fn() }));
vi.mock("./human-interview-rounds", () => ({ listHumanInterviewRounds: mocks.rounds }));

const input = { interviewRecordId: "candidate-a", organizationId: "org-a" };

function round(overrides: Partial<HumanInterviewRoundRecord> = {}): HumanInterviewRoundRecord {
  return {
    cancelReason: null,
    cancelledAt: null,
    completedAt: "2026-10-20T04:30:00.000Z",
    createdAt: "2026-10-19T02:00:00.000Z",
    externalInterviewers: [
      { id: "external-a", name: "外部面试官", telegram: "private-interviewer" },
    ],
    feedback: "第一行点评\n第二行点评",
    format: "online",
    id: "round-a",
    interviewRecordId: input.interviewRecordId,
    interviewers: [
      { id: "internal-a", image: "https://private.example/avatar", name: "内部面试官" },
    ],
    label: "技术面试",
    location: "内部会议室",
    meetingUrl: "https://private.example/meeting",
    notes: "不属于面试点评的内部备注",
    organizationId: input.organizationId,
    outcome: "pass",
    scheduledAt: "2026-10-20T03:00:00.000Z",
    score: 85,
    sortOrder: 2,
    status: "completed",
    updatedAt: "2026-10-20T04:30:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rounds.mockReset();
  mocks.rounds.mockResolvedValue([]);
});

describe("SSC Offer interview summary", () => {
  it("loads the authorized candidate and workspace once and combines internal and external names", async () => {
    mocks.rounds.mockResolvedValue([round()]);
    expect(await loadOfferSscInterviewSummary(input)).toEqual([
      {
        feedback: "第一行点评\n第二行点评",
        interviewers: [{ name: "内部面试官" }, { name: "外部面试官" }],
        label: "技术面试",
        scheduledAt: "2026-10-20T03:00:00.000Z",
        sortOrder: 2,
        status: "completed",
      },
    ]);
    expect(mocks.rounds).toHaveBeenCalledExactlyOnceWith("candidate-a", "org-a");
  });

  it("excludes pending, cancelled and foreign candidate or workspace rounds", async () => {
    mocks.rounds.mockResolvedValue([
      round({ id: "pending", status: "pending" }),
      round({ id: "cancelled", status: "cancelled" }),
      round({ id: "foreign-candidate", interviewRecordId: "candidate-b" }),
      round({ id: "foreign-workspace", organizationId: "org-b" }),
      round({ id: "completed", label: "本候选人的已完成面试" }),
    ]);
    const summary = await loadOfferSscInterviewSummary(input);
    expect(summary).toHaveLength(1);
    expect(summary[0].label).toBe("本候选人的已完成面试");
  });

  it("projects only the permitted interview fields without contact, account or internal note data", async () => {
    mocks.rounds.mockResolvedValue([round()]);
    const [summary] = await loadOfferSscInterviewSummary(input);
    expect(Object.keys(summary).toSorted()).toEqual([
      "feedback",
      "interviewers",
      "label",
      "scheduledAt",
      "sortOrder",
      "status",
    ]);
    expect(summary.interviewers).toEqual([{ name: "内部面试官" }, { name: "外部面试官" }]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("private-interviewer");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("内部备注");
    expect(serialized).not.toContain("internal-a");
    expect(serialized).not.toContain("external-a");
  });

  it("preserves absent schedule and feedback instead of substituting evaluation completion time", async () => {
    mocks.rounds.mockResolvedValue([
      round({
        externalInterviewers: undefined,
        feedback: null,
        interviewers: [],
        scheduledAt: null,
      }),
    ]);
    expect(await loadOfferSscInterviewSummary(input)).toEqual([
      {
        feedback: null,
        interviewers: [],
        label: "技术面试",
        scheduledAt: null,
        sortOrder: 2,
        status: "completed",
      },
    ]);
  });

  it("retains the whole multiline review without applying notification-length truncation", async () => {
    const feedback = `  第一段原始点评\n${"详细意见".repeat(1500)}\n结尾点评  `;
    mocks.rounds.mockResolvedValue([round({ feedback })]);
    const [summary] = await loadOfferSscInterviewSummary(input);
    expect(summary.feedback).toBe(feedback);
  });

  it("returns an empty summary when no completed rounds exist", async () => {
    expect(await loadOfferSscInterviewSummary(input)).toEqual([]);
    mocks.rounds.mockResolvedValue([round({ status: "pending" })]);
    expect(await loadOfferSscInterviewSummary(input)).toEqual([]);
  });

  it("propagates a read failure so callers cannot mistake it for no interview history", async () => {
    mocks.rounds.mockRejectedValue(new Error("interview history unavailable"));
    await expect(loadOfferSscInterviewSummary(input)).rejects.toThrow(
      "interview history unavailable",
    );
  });
});
