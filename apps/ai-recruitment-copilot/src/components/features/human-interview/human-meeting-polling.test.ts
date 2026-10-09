import { describe, expect, it } from "vitest";
import { getMeetingPollInterval } from "./human-meeting-polling";

const minute = 60_000;

describe("meeting status polling", () => {
  it.each([
    [undefined, 30_000],
    [null, 30_000],
    [0, 30_000],
    [1000, 30_000],
    [5 * minute, 30_000],
    [5 * minute + 1, 2 * minute],
    [30 * minute, 2 * minute],
    [30 * minute + 1, 5 * minute],
    [120 * minute, 5 * minute],
    [120 * minute + 1, 10 * minute],
    [24 * 60 * minute, 10 * minute],
  ])("uses %i ms remaining to choose %i ms", (remaining, interval) => {
    expect(getMeetingPollInterval(remaining)).toBe(interval);
  });
});
