import { describe, expect, it } from "vitest";
import { resolveOdcAnalysisRange } from "./date-range";

describe("ODC analysis date ranges", () => {
  it("uses inclusive Beijing calendar dates with an exclusive end instant", () => {
    expect(
      resolveOdcAnalysisRange({
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).toEqual({
      end: new Date("2026-08-31T16:00:00.000Z"),
      start: new Date("2026-07-31T16:00:00.000Z"),
    });
  });

  it("keeps an unbounded side null", () => {
    expect(resolveOdcAnalysisRange({ to: "2026-08-18" })).toEqual({
      end: new Date("2026-08-18T16:00:00.000Z"),
      start: null,
    });
  });
});
