import { describe, expect, it } from "vitest";
import { selectOdcAssignmentDrafts, serializeOdcAssignmentDrafts } from "./odc-assignment-draft";

describe("ODC assignment drafts", () => {
  it("preserves configured scopes while the selected member list changes", () => {
    expect(
      selectOdcAssignmentDrafts(
        [{ jobSeries: "直属", memberId: "member-1", serviceUnit: "悦达" }],
        ["member-1", "member-2"],
      ),
    ).toEqual([
      { jobSeries: "直属", memberId: "member-1", serviceUnit: "悦达" },
      { jobSeries: null, memberId: "member-2", serviceUnit: "" },
    ]);
  });

  it("normalizes an empty service unit before submitting", () => {
    expect(
      serializeOdcAssignmentDrafts([
        { jobSeries: "派驻", memberId: "member-1", serviceUnit: "  无极  " },
        { jobSeries: null, memberId: "member-2", serviceUnit: "   " },
      ]),
    ).toEqual([
      { jobSeries: "派驻", memberId: "member-1", serviceUnit: "无极" },
      { jobSeries: null, memberId: "member-2", serviceUnit: null },
    ]);
  });
});
