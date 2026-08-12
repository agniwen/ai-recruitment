import { describe, expect, it } from "vitest";
import { DATA_EXPORT_LIMIT, normalizeExportColumnIds, takeExportRows } from "./data-export-model";

describe("data export model", () => {
  it("keeps stored columns in the supported order and drops unknown values", () => {
    expect(
      normalizeExportColumnIds(
        ["candidateEmail", "removed-column", "candidateName", "candidateEmail"],
        ["candidateName", "candidateEmail", "createdAt"],
        ["candidateName", "createdAt"],
      ),
    ).toEqual(["candidateName", "candidateEmail"]);
  });

  it("falls back to defaults when local storage has no supported columns", () => {
    expect(
      normalizeExportColumnIds(
        ["removed-column"],
        ["candidateName", "candidateEmail", "createdAt"],
        ["candidateName", "createdAt"],
      ),
    ).toEqual(["candidateName", "createdAt"]);
  });

  it("caps an all-results export at 1000 rows", () => {
    const rows = Array.from({ length: DATA_EXPORT_LIMIT + 25 }, (_, index) => index);
    const result = takeExportRows(rows);

    expect(result.rows).toHaveLength(DATA_EXPORT_LIMIT);
    expect(result.truncated).toBe(true);
  });
});
