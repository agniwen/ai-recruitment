import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCalendarDays, formatDailyTooltip } from "./resume-library-charts";

describe("resume library upload calendar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a Sunday-aligned year grid with contribution levels", () => {
    const cells = buildCalendarDays([
      {
        byUser: [{ count: 2, userId: "user-1", userName: "Alice" }],
        count: 2,
        day: "2026-08-04",
      },
      {
        byUser: [{ count: 8, userId: "user-2", userName: "Bob" }],
        count: 8,
        day: "2026-08-05",
      },
    ]);

    expect(cells.filter((cell) => cell.inRange)).toHaveLength(365);
    expect(cells[0]).toMatchObject({ day: "2025-08-03", inRange: false, weekday: "日" });
    expect(cells.at(-1)).toMatchObject({ day: "2026-08-08", inRange: false, weekday: "六" });
    expect(cells.find((cell) => cell.day === "2026-08-04")).toMatchObject({ count: 2, level: 1 });
    expect(cells.find((cell) => cell.day === "2026-08-05")).toMatchObject({ count: 8, level: 4 });
  });

  it("formats each uploader contribution in the daily tooltip", () => {
    const cell = buildCalendarDays([
      {
        byUser: [
          { count: 3, userId: "user-1", userName: "Alice" },
          { count: 1, userId: "user-2", userName: "Bob" },
        ],
        count: 4,
        day: "2026-08-05",
      },
    ]).find((item) => item.day === "2026-08-05");

    if (!cell) {
      throw new Error("expected the current day to be present in the calendar grid");
    }
    expect(formatDailyTooltip(cell)).toBe("2026-08-05 · 共 4 份\nAlice：3 份\nBob：1 份");
  });
});
