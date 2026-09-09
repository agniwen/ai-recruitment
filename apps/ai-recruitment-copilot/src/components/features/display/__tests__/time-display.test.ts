import { afterEach, describe, expect, it } from "vitest";
import { formatTimeDisplayText, formatTimeDisplayTooltipRows } from "../time-display";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

describe("formatTimeDisplayText", () => {
  it.each(["UTC", "Asia/Tokyo", "Asia/Shanghai", "America/Los_Angeles"])(
    "always uses China time in %s",
    (zone) => {
      process.env.TZ = zone;

      expect(formatTimeDisplayText("2026-09-09T14:06:00.000Z")).toBe("26/09/09 22:06");
      expect(formatTimeDisplayText("2026-06-02T09:30:00.000Z", "YY/MM/DD HH:mm")).toBe(
        "26/06/02 17:30",
      );
    },
  );

  it("returns null for invalid values", () => {
    expect(formatTimeDisplayText("not-a-date")).toBeNull();
  });
});

describe("formatTimeDisplayTooltipRows", () => {
  it("shows only China time", () => {
    expect(formatTimeDisplayTooltipRows("2026-06-02T09:30:00.000Z")).toEqual([
      { label: "中国时区", text: "26/06/02 17:30" },
    ]);
  });

  it("returns no tooltip rows for invalid values", () => {
    expect(formatTimeDisplayTooltipRows("not-a-date")).toEqual([]);
  });
});
