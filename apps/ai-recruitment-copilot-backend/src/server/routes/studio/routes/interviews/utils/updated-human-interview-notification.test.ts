import { beforeEach, expect, it, vi } from "vitest";
import type { HumanInterviewRoundRecord } from "@arc/shared/studio-pipeline-stages";
import { notifyUpdatedHumanInterviewRound } from "./updated-human-interview-notification";

const mocks = vi.hoisted(() => ({ meetings: vi.fn(), notify: vi.fn() }));
vi.mock("../dao/human-interview-meetings", () => ({ listHumanInterviewMeetings: mocks.meetings }));
vi.mock("./external-interviewer-notification", () => ({
  notifyExternalInterviewers: mocks.notify,
}));
const round: HumanInterviewRoundRecord = {
  cancelReason: null,
  cancelledAt: null,
  completedAt: null,
  createdAt: "2026-09-29T00:00:00Z",
  feedback: null,
  format: "online",
  id: "round",
  interviewRecordId: "candidate",
  interviewers: [],
  label: "更新的名称",
  location: null,
  meetingUrl: null,
  notes: null,
  organizationId: "org",
  outcome: null,
  scheduledAt: "2026-10-01T01:00:00Z",
  score: null,
  sortOrder: 0,
  status: "pending",
  updatedAt: "2026-09-29T01:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockResolvedValue([]);
});
it("resends the current scheduled meeting after each save and excludes other rounds", async () => {
  const meeting = {
    id: "meeting",
    rounds: [{ roundId: round.id }],
    status: "scheduled",
    title: round.label,
  };
  mocks.meetings.mockResolvedValue([
    meeting,
    { id: "other", rounds: [{ roundId: "other-round" }], status: "scheduled" },
    { id: "ended", rounds: [{ roundId: round.id }], status: "ended" },
  ]);
  expect(await notifyUpdatedHumanInterviewRound(round)).toEqual([]);
  expect(await notifyUpdatedHumanInterviewRound(round)).toEqual([]);
  expect(mocks.notify).toHaveBeenCalledTimes(2);
  expect(mocks.notify).toHaveBeenCalledWith(meeting, "updated");
});
it("returns delivery failures without rejecting the committed save", async () => {
  mocks.meetings.mockResolvedValue([{ rounds: [{ roundId: round.id }], status: "scheduled" }]);
  mocks.notify.mockResolvedValue(["吉米"]);
  expect(await notifyUpdatedHumanInterviewRound(round)).toEqual(["吉米"]);
  mocks.meetings.mockRejectedValue(new Error("lookup failed"));
  expect(await notifyUpdatedHumanInterviewRound(round)).toEqual(["面试官通知发送异常"]);
});
it("does not resend meeting invitations for evaluation edits", async () => {
  expect(await notifyUpdatedHumanInterviewRound({ ...round, status: "completed" })).toEqual([]);
  expect(mocks.meetings).not.toHaveBeenCalled();
});
