import { describe, expect, it } from "vitest";
import { offerPreboardingDateSchema } from "../offer-preboarding";

describe("SSC preboarding calendar date", () => {
  it.each(["2026-11-01", "2028-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])(
    "preserves valid date-only input %s",
    (value) => {
      expect(offerPreboardingDateSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "0000-01-01",
    "2026-1-01",
    "2026/01/01",
    "2026-01-01T00:00:00Z",
    "",
  ])("rejects invalid or ambiguous input %j", (value) => {
    expect(offerPreboardingDateSchema.safeParse(value).success).toBe(false);
  });
});
