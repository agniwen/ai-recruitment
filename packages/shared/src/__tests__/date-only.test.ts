import { describe, expect, it } from "vitest";
import { dateOnlyStringToLocalDate, localDateToDateOnlyString } from "../date-only";

describe("date-only helpers", () => {
  it("converts yyyy-mm-dd strings to local dates without UTC shifting", () => {
    const date = dateOnlyStringToLocalDate("2026-06-01");

    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(5);
    expect(date?.getDate()).toBe(1);
  });

  it("formats local dates back to yyyy-mm-dd", () => {
    const value = localDateToDateOnlyString(new Date(2026, 4, 7));

    expect(value).toBe("2026-05-07");
  });

  it("returns null for invalid date-only strings", () => {
    expect(dateOnlyStringToLocalDate("2026/06/01")).toBeNull();
  });
});
