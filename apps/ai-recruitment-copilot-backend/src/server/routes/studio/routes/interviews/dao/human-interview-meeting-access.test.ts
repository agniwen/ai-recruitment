import { afterEach, expect, it, vi } from "vitest";
import {
  getHumanInterviewMeetingEntryAccess,
  isHumanInterviewMeetingBeforeScheduledStart,
} from "./human-interview-meeting-access";

afterEach(() => vi.restoreAllMocks());

it("opens entry exactly ten minutes before the scheduled interview", () => {
  const scheduledAt = "2026-09-29T08:30:00.000Z";
  const opensAt = new Date("2026-09-29T08:20:00.000Z").getTime();
  const now = vi.spyOn(Date, "now");
  now.mockReturnValue(opensAt - 1);
  expect(isHumanInterviewMeetingBeforeScheduledStart(scheduledAt)).toBe(true);
  now.mockReturnValue(opensAt);
  expect(isHumanInterviewMeetingBeforeScheduledStart(scheduledAt)).toBe(false);
  now.mockReturnValue(opensAt + 1);
  expect(isHumanInterviewMeetingBeforeScheduledStart(scheduledAt)).toBe(false);
});

it("returns server-controlled access at the Beijing opening boundary", () => {
  const meeting = {
    scheduledAt: "2026-09-30T08:00:00.000Z",
    status: "scheduled" as const,
    validUntil: "2026-09-30T09:00:00.000Z",
  };
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T07:49:59.000Z"));
  expect(getHumanInterviewMeetingEntryAccess(meeting)).toEqual({
    canJoin: false,
    reason: "too_early",
    recheckAfterMs: 1000,
  });
  vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-30T07:50:00.000Z"));
  expect(getHumanInterviewMeetingEntryAccess(meeting).canJoin).toBe(true);
  vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-30T08:00:00.000Z"));
  expect(getHumanInterviewMeetingEntryAccess(meeting).canJoin).toBe(true);
});

it("rejects closed and expired meetings, including expired in-progress meetings", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T08:00:00.000Z"));
  const meeting = { scheduledAt: null, validUntil: "2026-09-30T09:00:00.000Z" };
  for (const status of ["ended", "cancelled"] as const) {
    expect(getHumanInterviewMeetingEntryAccess({ ...meeting, status }).reason).toBe("closed");
  }
  expect(
    getHumanInterviewMeetingEntryAccess({
      ...meeting,
      status: "in_progress",
      validUntil: "2026-09-30T07:59:59.000Z",
    }).reason,
  ).toBe("expired");
  expect(
    getHumanInterviewMeetingEntryAccess({
      ...meeting,
      status: "scheduled",
      validUntil: null,
    }).reason,
  ).toBe("expired");
  expect(getHumanInterviewMeetingEntryAccess({ ...meeting, status: "in_progress" }).canJoin).toBe(
    true,
  );
});
