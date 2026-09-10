import { readFileSync } from "node:fs";
import type {
  HumanInterviewMeetingRecord,
  HumanInterviewRoundRecord,
} from "@arc/shared/studio-pipeline-stages";
import { describe, expect, it } from "vitest";
import { canCompleteHumanInterviewRound } from "./human-interview-stage-utils";

const dialogSource = readFileSync(
  new URL("human-interview-stage-dialogs.tsx", import.meta.url),
  "utf-8",
);

describe("human interview editing gates", () => {
  it("initializes scheduling from the configured interviewers and requires a selection", () => {
    expect(dialogSource).toContain("setInterviewerIds([...defaultInterviewerIds])");
    expect(dialogSource).toContain("interviewerIds,");
    expect(dialogSource).toContain("disabled={mutation.isPending || interviewerIds.length === 0}");
  });

  it("validates and trims feedback before submitting completion", () => {
    const validation = dialogSource.indexOf('throw new Error("请填写面试评价")');
    const submission = dialogSource.indexOf("return completeHumanInterviewRound(");
    expect(validation).toBeGreaterThan(0);
    expect(submission).toBeGreaterThan(validation);
    expect(dialogSource).toContain("feedback: trimmedFeedback");
  });

  it.each([
    ["pending", "ended", false, true],
    ["pending", "in_progress", false, false],
    ["pending", "scheduled", false, false],
    ["pending", null, false, false],
    ["completed", "ended", false, false],
    ["cancelled", "ended", false, false],
    ["pending", "ended", true, false],
  ] as const)(
    "completion gate: round %s, meeting %s, disabled %s",
    (status, meetingStatus, disabled, expected) => {
      const round = { status } as HumanInterviewRoundRecord;
      const meeting = meetingStatus
        ? ({ status: meetingStatus } as HumanInterviewMeetingRecord)
        : null;
      expect(canCompleteHumanInterviewRound(round, meeting, disabled)).toBe(expected);
    },
  );
});
