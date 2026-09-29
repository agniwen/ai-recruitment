import { afterEach, expect, it, vi } from "vitest";
import { isHumanInterviewMeetingBeforeScheduledStart } from "./human-interview-meeting-access";

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
