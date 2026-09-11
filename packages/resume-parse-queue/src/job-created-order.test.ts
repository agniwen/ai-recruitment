import { describe, expect, it } from "vitest";
import { pageJobsByCreatedAt } from "./job-created-order";

describe("queue creation-time pagination", () => {
  it("orders across states before slicing pages instead of using completion order", () => {
    const jobs = [
      { id: "old-completed", timestamp: 100 },
      { id: "new-waiting", timestamp: 400 },
      { id: "old-failed", timestamp: 200 },
      { id: "new-active", timestamp: 300 },
    ];
    expect(pageJobsByCreatedAt(jobs, 0, 2).map((job) => job.id)).toEqual([
      "new-waiting",
      "new-active",
    ]);
    expect(pageJobsByCreatedAt(jobs, 2, 2).map((job) => job.id)).toEqual([
      "old-failed",
      "old-completed",
    ]);
    expect(jobs[0].id).toBe("old-completed");
  });
  it("uses a deterministic order for identical timestamps", () => {
    expect(
      pageJobsByCreatedAt(
        [
          { id: "a", timestamp: 100 },
          { id: "b", timestamp: 100 },
        ],
        0,
        1,
      )[0].id,
    ).toBe("b");
  });
});
